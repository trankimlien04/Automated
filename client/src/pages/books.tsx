import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Plus, Search, QrCode, Filter, Star, Edit, Trash2, BookOpen, Download, 
  CheckCircle2, BookmarkPlus, FileSpreadsheet, Upload, FileDown, AlertCircle, 
  Info, Eye, Calendar, Building, FileText, Clock, Compass, Layers, 
  ArrowRightLeft, FolderTree, ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Sparkles, MapPin, 
  Grid3X3, ArrowUpRight, ArrowRight, X, SlidersHorizontal, Check, ExternalLink, Copy,
  Camera, ShieldCheck, Zap, User, RotateCcw, Minus, Scan
} from "lucide-react";
import * as XLSX from "xlsx";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { QRCodeCanvas } from "qrcode.react";
import BookReviews from "@/components/book-reviews";
import {
  LibraryMiniMapModal,
  loadLibraryLayoutConfig,
  saveLibraryLayoutConfig,
  type LibraryLayoutConfig,
  pad2,
} from "@/components/library-mini-map-modal";
import { SmartShelfAuditModal } from "@/components/smart-shelf-audit-modal";
import { runSmartBookSearch, type SmartMatchMeta } from "@/lib/smart-search";
import { optimizeMultiBookPickPath } from "@/lib/pick-path";

export interface SmartWaitPrediction {
  estimated_wait_days: number;
  expected_available_date: string;
  expected_date_vn: string;
  earliest_due_date: string;
  earliest_due_date_vn: string;
  waiting_ahead_count: number;
  queue_position: number;
  active_borrowed_count: number;
  summary_text: string;
}

interface Book {
  id: number;
  title: string;
  author_id?: number;
  author_name?: string;
  publisher_id?: number;
  publisher_name?: string;
  category_id?: number;
  category_name?: string;
  isbn?: string;
  published_year?: number;
  description?: string;
  cover_image?: string;
  total_copies: number;
  available_copies: number;
  location?: string;
  avg_rating?: string | number;
  review_count?: number;
  waiting_queue_count?: number;
  wait_prediction?: SmartWaitPrediction | null;
  _smartMatch?: SmartMatchMeta;
}

export default function BooksPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [booksList, setBooksList] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // View mode switcher: 'catalog' | 'rooms' | 'categories'
  const [activeViewTab, setActiveViewTab] = useState<"catalog" | "rooms" | "categories">("catalog");

  // Filters for catalog
  const [q, setQ] = useState(() => searchParams.get("search") || "");

  useEffect(() => {
    const paramSearch = searchParams.get("search");
    if (paramSearch !== null && paramSearch !== q) {
      setQ(paramSearch);
    }
  }, [searchParams]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");
  const [selectedRoomFilter, setSelectedRoomFilter] = useState("all");
  const [selectedShelfFilter, setSelectedShelfFilter] = useState("all");
  
  // Pagination State for Books Catalog
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12); // Default 12 books per page (perfect for 4/3/2 column grids)
  const catalogTopRef = useRef<HTMLDivElement>(null);

  // Room view states
  const [expandedShelves, setExpandedShelves] = useState<Record<string, boolean>>({});
  const [roomSearchQ, setRoomSearchQ] = useState("");

  // Category matrix view states
  const [categorySearchQ, setCategorySearchQ] = useState("");

  // Relocation Modal State
  const [relocateModalOpen, setRelocateModalOpen] = useState(false);
  const [relocatingBook, setRelocatingBook] = useState<Book | null>(null);
  const [relocateRoom, setRelocateRoom] = useState("Phòng 01");
  const [relocateShelf, setRelocateShelf] = useState("Kệ 01");
  const [relocateRack, setRelocateRack] = useState("Ngăn 01");
  const [customLocation, setCustomLocation] = useState("");
  const [useCustomLocation, setUseCustomLocation] = useState(false);
  const [isSubmittingRelocate, setIsSubmittingRelocate] = useState(false);

  // Form states for adding book
  const [newTitle, setNewTitle] = useState("");
  const [selectedAuthor, setSelectedAuthor] = useState("");
  const [selectedPublisher, setSelectedPublisher] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [newIsbn, setNewIsbn] = useState("");
  const [newCopies, setNewCopies] = useState(1);
  const [newBookRoom, setNewBookRoom] = useState("Phòng 01");
  const [newBookShelf, setNewBookShelf] = useState("Kệ 01");
  const [newBookRack, setNewBookRack] = useState("Ngăn 01");
  const [newLocation, setNewLocation] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Library Spatial Layout Config (Rooms, Shelves per Room, Racks per Shelf)
  const [layoutConfig, setLayoutConfig] = useState<LibraryLayoutConfig>(() =>
    loadLibraryLayoutConfig()
  );

  useEffect(() => {
    const handler = () => setLayoutConfig(loadLibraryLayoutConfig());
    window.addEventListener("athenaeum-layout-updated", handler);
    return () => window.removeEventListener("athenaeum-layout-updated", handler);
  }, []);

  // Excel Batch Import States
  const [isExcelDialogOpen, setIsExcelDialogOpen] = useState(false);
  const [excelParsedData, setExcelParsedData] = useState<any[]>([]);
  const [excelFileName, setExcelFileName] = useState("");
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [authors, setAuthors] = useState<{ id: number; name: string }[]>([]);
  const [publishers, setPublishers] = useState<{ id: number; name: string }[]>([]);

  // QR Code viewing state
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedBookForQr, setSelectedBookForQr] = useState<Book | null>(null);
  const [bookCopies, setBookCopies] = useState<any[]>([]);
  const [activeBookHolds, setActiveBookHolds] = useState<any[]>([]);
  const [loadingQr, setLoadingQr] = useState(false);

  // Book Detail viewing state
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedBookForDetail, setSelectedBookForDetail] = useState<Book | null>(null);

  // Mini Map Wayfinding State
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [miniMapTarget, setMiniMapTarget] = useState<{
    location?: string;
    title?: string;
    author?: string;
    cover?: string;
  } | null>(null);

  // Smart Shelf Inventory Audit State (Kiểm kê kho sách nhanh bằng quét QR hàng loạt)
  const [shelfAuditOpen, setShelfAuditOpen] = useState(false);
  const [shelfAuditLocation, setShelfAuditLocation] = useState("Phòng 01 - Kệ 01 - Ngăn 01");

  const handleOpenShelfAudit = (loc?: string) => {
    setShelfAuditLocation(loc || "Phòng 01 - Kệ 01 - Ngăn 01");
    setShelfAuditOpen(true);
  };

  // Reader's active borrow requests and reservations state
  const [myBorrowRequests, setMyBorrowRequests] = useState<any[]>([]);
  const [myReservations, setMyReservations] = useState<any[]>([]);
  const [myActiveDraft, setMyActiveDraft] = useState<any | null>(null);
  const [isDraftQrModalOpen, setIsDraftQrModalOpen] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "librarian";

  // Helper to parse location string "Phòng XX - Kệ YY - Ngăn ZZ"
  const parseLocation = (loc?: string) => {
    if (!loc || !loc.trim()) {
      return { room: "Phòng 01", shelf: "Kệ 01", rack: "Ngăn 01", raw: "Phòng 01 - Kệ 01 - Ngăn 01" };
    }
    const parts = loc.split("-").map(p => p.trim());
    return {
      room: parts[0] || "Phòng 01",
      shelf: parts[1] || "Kệ 01",
      rack: parts[2] || "Ngăn 01",
      raw: loc
    };
  };

  const handleOpenMiniMap = (book?: Partial<Book> | { location?: string; title?: string; author?: string; cover?: string } | null) => {
    if (!book) return;
    setMiniMapTarget({
      location: book.location || "Phòng 01 - Kệ 01 - Ngăn 01",
      title: "title" in book ? book.title : undefined,
      author: "author_name" in book ? book.author_name : "author" in book ? (book as any).author : undefined,
      cover: "cover_image" in book ? book.cover_image : "cover" in book ? (book as any).cover : undefined,
    });
    setMiniMapOpen(true);
  };

  const handleOpenBookDetail = (book: Book) => {
    setSelectedBookForDetail(book);
    setDetailDialogOpen(true);
  };

  const toggleShelfExpanded = (key: string) => {
    setExpandedShelves(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Open relocation dialog
  const handleOpenRelocate = (book: Book) => {
    setRelocatingBook(book);
    const parsed = parseLocation(book.location);
    setRelocateRoom(parsed.room);
    setRelocateShelf(parsed.shelf);
    setRelocateRack(parsed.rack);
    setCustomLocation(book.location || "");
    setUseCustomLocation(false);
    setRelocateModalOpen(true);
  };

  // Submit relocation update
  const handleConfirmRelocate = async () => {
    if (!relocatingBook) return;
    const finalLoc = useCustomLocation 
      ? customLocation.trim() 
      : `${relocateRoom} - ${relocateShelf} - ${relocateRack}`;

    if (!finalLoc) {
      toast.error("Vui lòng nhập vị trí lưu kho hợp lệ");
      return;
    }

    setIsSubmittingRelocate(true);
    try {
      await api.put(`/books/${relocatingBook.id}`, { location: finalLoc });
      toast.success(`Đã chuyển đầu sách "${relocatingBook.title}" sang vị trí mới: ${finalLoc}`);
      
      // Update local state
      setBooksList(prev => prev.map(b => b.id === relocatingBook.id ? { ...b, location: finalLoc } : b));
      if (selectedBookForDetail?.id === relocatingBook.id) {
        setSelectedBookForDetail(prev => prev ? { ...prev, location: finalLoc } : null);
      }
      setRelocateModalOpen(false);
    } catch (err: any) {
      console.error("Lỗi điều chuyển sách:", err);
      toast.error(err.response?.data?.message || "Không thể cập nhật vị trí sách");
    } finally {
      setIsSubmittingRelocate(false);
    }
  };

  // Spatial aggregation: Room -> Categories, Shelves & Racks (Merged with layoutConfig)
  const spatialRooms = useMemo(() => {
    const map = new Map<string, {
      roomNum: number;
      roomName: string;
      booksCount: number;
      copiesCount: number;
      availableCopiesCount: number;
    }>();

    // Pre-populate rooms from layoutConfig (at least 3 default rooms)
    const maxConfiguredRoom = Math.max(3, layoutConfig.maxRoom || 3);
    for (let r = 1; r <= maxConfiguredRoom; r++) {
      const rName = `Phòng ${pad2(r)}`;
      map.set(rName, { roomNum: r, roomName: rName, booksCount: 0, copiesCount: 0, availableCopiesCount: 0 });
    }

    booksList.forEach(b => {
      const parsed = parseLocation(b.location);
      const rMatch = parsed.room.match(/\d+/);
      const rNum = rMatch ? Math.max(1, parseInt(rMatch[0], 10)) : 1;
      if (!map.has(parsed.room)) {
        map.set(parsed.room, { roomNum: rNum, roomName: parsed.room, booksCount: 0, copiesCount: 0, availableCopiesCount: 0 });
      }
    });

    const result = Array.from(map.values()).map(({ roomNum, roomName }) => {
      const roomBooks = booksList.filter(b => parseLocation(b.location).room === roomName);

      // Categories in this room
      const catMap = new Map<string, { id?: number; name: string; count: number; totalCopies: number }>();
      roomBooks.forEach(b => {
        const catName = b.category_name || "Chưa phân loại";
        const existing = catMap.get(catName) || { id: b.category_id, name: catName, count: 0, totalCopies: 0 };
        existing.count += 1;
        existing.totalCopies += (b.total_copies || 0);
        catMap.set(catName, existing);
      });

      // Shelves in this room (pre-populate from layoutConfig.shelvesPerRoom[roomNum] or default 6)
      const shelfMap = new Map<string, {
        shelfNum: number;
        shelfName: string;
        books: Book[];
        categories: Set<string>;
        totalCopies: number;
        availableCopies: number;
      }>();

      const configuredMaxShelf = Math.max(6, layoutConfig.shelvesPerRoom[roomNum] || 6);
      for (let s = 1; s <= configuredMaxShelf; s++) {
        const sName = `Kệ ${pad2(s)}`;
        shelfMap.set(sName, {
          shelfNum: s,
          shelfName: sName,
          books: [],
          categories: new Set(),
          totalCopies: 0,
          availableCopies: 0,
        });
      }

      roomBooks.forEach(b => {
        const shelfName = parseLocation(b.location).shelf;
        const sMatch = shelfName.match(/\d+/);
        const sNum = sMatch ? Math.max(1, parseInt(sMatch[0], 10)) : 1;
        if (!shelfMap.has(shelfName)) {
          shelfMap.set(shelfName, {
            shelfNum: sNum,
            shelfName,
            books: [],
            categories: new Set(),
            totalCopies: 0,
            availableCopies: 0,
          });
        }
        const sData = shelfMap.get(shelfName)!;
        sData.books.push(b);
        if (b.category_name) sData.categories.add(b.category_name);
        sData.totalCopies += (b.total_copies || 0);
        sData.availableCopies += (b.available_copies || 0);
      });

      const sortedShelves = Array.from(shelfMap.values())
        .sort((a, b) => a.shelfName.localeCompare(b.shelfName, undefined, { numeric: true }))
        .map(s => {
          // Compute max rack on this shelf
          let maxRack = Math.max(5, layoutConfig.racksPerShelf[`${roomNum}_${s.shelfNum}`] || 5);
          s.books.forEach(bk => {
            const rkMatch = parseLocation(bk.location).rack.match(/\d+/);
            const rkNum = rkMatch ? parseInt(rkMatch[0], 10) : 1;
            if (rkNum > maxRack) maxRack = rkNum;
          });

          const racks: Array<{ rackNum: number; rackName: string; bookCount: number }> = [];
          for (let rk = 1; rk <= maxRack; rk++) {
            const rkName = `Ngăn ${pad2(rk)}`;
            const count = s.books.filter(bk => parseLocation(bk.location).rack === rkName).length;
            racks.push({ rackNum: rk, rackName: rkName, bookCount: count });
          }

          return {
            shelfNum: s.shelfNum,
            shelfName: s.shelfName,
            books: s.books.sort((x, y) => parseLocation(x.location).rack.localeCompare(parseLocation(y.location).rack, undefined, { numeric: true })),
            categories: Array.from(s.categories),
            totalCopies: s.totalCopies,
            availableCopies: s.availableCopies,
            maxRack,
            racks,
          };
        });

      return {
        roomNum,
        roomName,
        booksCount: roomBooks.length,
        copiesCount: roomBooks.reduce((acc, b) => acc + (b.total_copies || 0), 0),
        availableCopiesCount: roomBooks.reduce((acc, b) => acc + (b.available_copies || 0), 0),
        categories: Array.from(catMap.values()).sort((a, b) => b.count - a.count),
        shelves: sortedShelves,
      };
    });

    return result.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true }));
  }, [booksList, layoutConfig]);

  // Librarian Handlers for Adding / Removing Rooms, Shelves, and Racks directly
  const handleAddRoomToLibrary = () => {
    const currentMaxRoom = spatialRooms.reduce((m, r) => Math.max(m, r.roomNum), layoutConfig.maxRoom || 3);
    const nextRoomNum = currentMaxRoom + 1;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      maxRoom: nextRoomNum,
      shelvesPerRoom: {
        ...layoutConfig.shelvesPerRoom,
        [nextRoomNum]: 6,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.success(`Đã thêm Phòng ${pad2(nextRoomNum)} (kèm 6 kệ sách mặc định) vào sơ đồ thư viện!`);
  };

  const handleRemoveEmptyRoom = (roomNum: number, roomName: string, booksCount: number) => {
    if (booksCount > 0) {
      toast.error(`${roomName} đang có ${booksCount} đầu sách, không thể xóa!`);
      return;
    }
    if (roomNum <= 3) {
      toast.error("Không thể xóa 3 phòng tiêu chuẩn mặc định của thư viện (Phòng 01 - Phòng 03).");
      return;
    }
    const currentMax = spatialRooms.length;
    const nextMax = Math.max(3, currentMax - 1);
    const nextShelvesPerRoom = { ...layoutConfig.shelvesPerRoom };
    delete nextShelvesPerRoom[roomNum];
    delete nextShelvesPerRoom[currentMax];

    const nextRacksPerShelf = { ...layoutConfig.racksPerShelf };
    Object.keys(nextRacksPerShelf).forEach((k) => {
      if (k.startsWith(`${roomNum}_`) || k.startsWith(`${currentMax}_`)) {
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
    toast.info(`Đã xóa ${roomName} khỏi sơ đồ thư viện.`);
  };

  const handleAddShelfToRoom = (roomNum: number, roomName: string, currentShelfCount: number) => {
    const nextShelfNum = currentShelfCount + 1;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      shelvesPerRoom: {
        ...layoutConfig.shelvesPerRoom,
        [roomNum]: nextShelfNum,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.success(`Đã thêm Kệ ${pad2(nextShelfNum)} vào ${roomName}! Sơ đồ dẫn đường đã tự động cập nhật.`);
  };

  const handleRemoveLastShelfFromRoom = (roomNum: number, roomName: string, lastShelf: { shelfNum: number; shelfName: string; books: Book[] }) => {
    if (lastShelf.books.length > 0) {
      toast.error(`${lastShelf.shelfName} đang có ${lastShelf.books.length} đầu sách, không thể xóa!`);
      return;
    }
    if (lastShelf.shelfNum <= 6) {
      toast.error("Mỗi phòng có tối thiểu 6 kệ tiêu chuẩn (Kệ 01 - Kệ 06).");
      return;
    }
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      shelvesPerRoom: {
        ...layoutConfig.shelvesPerRoom,
        [roomNum]: lastShelf.shelfNum - 1,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.info(`Đã thu gọn ${lastShelf.shelfName} khỏi ${roomName}.`);
  };

  const handleAddRackToShelf = (roomNum: number, roomName: string, shelfNum: number, shelfName: string, currentMaxRack: number) => {
    const nextRackNum = currentMaxRack + 1;
    const key = `${roomNum}_${shelfNum}`;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      racksPerShelf: {
        ...layoutConfig.racksPerShelf,
        [key]: nextRackNum,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.success(`Đã thêm Ngăn ${pad2(nextRackNum)} vào ${shelfName} (${roomName})! Sơ đồ kệ đã tự động cập nhật.`);
  };

  const handleRemoveTopRackFromShelf = (
    roomNum: number,
    shelfNum: number,
    shelfName: string,
    currentMaxRack: number,
    topRackBookCount: number
  ) => {
    if (topRackBookCount > 0) {
      toast.error(`Ngăn ${pad2(currentMaxRack)} đang có ${topRackBookCount} đầu sách, không thể xóa!`);
      return;
    }
    if (currentMaxRack <= 5) {
      toast.error("Mỗi kệ có tối thiểu 5 ngăn tiêu chuẩn (Ngăn 01 - Ngăn 05).");
      return;
    }
    const key = `${roomNum}_${shelfNum}`;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      racksPerShelf: {
        ...layoutConfig.racksPerShelf,
        [key]: currentMaxRack - 1,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.info(`Đã thu gọn Ngăn ${pad2(currentMaxRack)} khỏi ${shelfName}.`);
  };

  // Category Matrix aggregation: Category -> Primary Room & Shelves Distribution
  const categoryMatrix = useMemo(() => {
    const map = new Map<string, {
      categoryId?: number;
      categoryName: string;
      booksCount: number;
      totalCopies: number;
      availableCopies: number;
      roomsMap: Map<string, { roomName: string; shelves: Set<string>; bookCount: number }>;
      books: Book[];
    }>();

    // Pre-populate with known categories
    categories.forEach(c => {
      map.set(c.name, {
        categoryId: c.id,
        categoryName: c.name,
        booksCount: 0,
        totalCopies: 0,
        availableCopies: 0,
        roomsMap: new Map(),
        books: []
      });
    });

    booksList.forEach(b => {
      const catName = b.category_name || "Chưa phân loại";
      if (!map.has(catName)) {
        map.set(catName, {
          categoryId: b.category_id,
          categoryName: catName,
          booksCount: 0,
          totalCopies: 0,
          availableCopies: 0,
          roomsMap: new Map(),
          books: []
        });
      }
      const entry = map.get(catName)!;
      entry.booksCount += 1;
      entry.totalCopies += (b.total_copies || 0);
      entry.availableCopies += (b.available_copies || 0);
      entry.books.push(b);

      const parsed = parseLocation(b.location);
      if (!entry.roomsMap.has(parsed.room)) {
        entry.roomsMap.set(parsed.room, {
          roomName: parsed.room,
          shelves: new Set(),
          bookCount: 0
        });
      }
      const rInfo = entry.roomsMap.get(parsed.room)!;
      rInfo.shelves.add(parsed.shelf);
      rInfo.bookCount += 1;
    });

    return Array.from(map.values())
      .map(item => {
        const sortedRooms = Array.from(item.roomsMap.values())
          .sort((a, b) => b.bookCount - a.bookCount)
          .map(r => ({
            roomName: r.roomName,
            shelves: Array.from(r.shelves).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
            bookCount: r.bookCount
          }));

        return {
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          booksCount: item.booksCount,
          totalCopies: item.totalCopies,
          availableCopies: item.availableCopies,
          primaryRoom: sortedRooms[0]?.roomName || "Chưa xếp",
          primaryShelves: sortedRooms[0]?.shelves || [],
          roomsList: sortedRooms,
          books: item.books
        };
      })
      .sort((a, b) => b.booksCount - a.booksCount);
  }, [categories, booksList]);

  // Smart placement suggestion for relocating book
  const suggestedPlacement = useMemo(() => {
    if (!relocatingBook) return null;
    const catName = relocatingBook.category_name;
    if (!catName) return null;
    const foundCat = categoryMatrix.find(c => c.categoryName === catName);
    if (!foundCat || foundCat.roomsList.length === 0) return null;
    const bestRoom = foundCat.roomsList[0];
    const bestShelf = bestRoom.shelves[0] || "Kệ 01";
    return {
      room: bestRoom.roomName,
      shelf: bestShelf,
      count: bestRoom.bookCount,
      category: catName
    };
  }, [relocatingBook, categoryMatrix]);

  // List of rooms for filters
  const availableRooms = useMemo(() => {
    const set = new Set<string>();
    const maxR = Math.max(3, layoutConfig.maxRoom || 3);
    for (let r = 1; r <= maxR; r++) set.add(`Phòng ${pad2(r)}`);
    booksList.forEach(b => {
      const p = parseLocation(b.location);
      if (p.room) set.add(p.room);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [booksList, layoutConfig]);

  // List of shelves for filters
  const availableShelves = useMemo(() => {
    const set = new Set<string>();
    let maxS = 6;
    Object.values(layoutConfig.shelvesPerRoom || {}).forEach(v => {
      if (v > maxS) maxS = v;
    });
    for (let s = 1; s <= maxS; s++) set.add(`Kệ ${pad2(s)}`);
    booksList.forEach(b => {
      const p = parseLocation(b.location);
      if (selectedRoomFilter === "all" || p.room === selectedRoomFilter) {
        if (p.shelf) set.add(p.shelf);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [booksList, selectedRoomFilter, layoutConfig]);

  // Dynamic options for Relocation & Add Book (auto-expands when new Rooms, Shelves, or Racks exist)
  const dynamicRoomOptions = useMemo(() => {
    const set = new Set<string>();
    const maxR = Math.max(3, layoutConfig.maxRoom || 3);
    for (let r = 1; r <= maxR; r++) set.add(`Phòng ${pad2(r)}`);
    booksList.forEach(b => {
      const p = parseLocation(b.location);
      if (p.room) set.add(p.room);
    });
    if (relocateRoom) set.add(relocateRoom);
    if (newBookRoom) set.add(newBookRoom);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [booksList, relocateRoom, newBookRoom, layoutConfig]);

  const dynamicShelfOptions = useMemo(() => {
    const set = new Set<string>();
    let maxS = 6;
    Object.values(layoutConfig.shelvesPerRoom || {}).forEach(v => {
      if (v > maxS) maxS = v;
    });
    for (let s = 1; s <= maxS; s++) set.add(`Kệ ${pad2(s)}`);
    booksList.forEach(b => {
      const p = parseLocation(b.location);
      if (p.shelf) set.add(p.shelf);
    });
    if (relocateShelf) set.add(relocateShelf);
    if (newBookShelf) set.add(newBookShelf);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [booksList, relocateShelf, newBookShelf, layoutConfig]);

  const dynamicRackOptions = useMemo(() => {
    const set = new Set<string>();
    let maxRk = 5;
    Object.values(layoutConfig.racksPerShelf || {}).forEach(v => {
      if (v > maxRk) maxRk = v;
    });
    for (let rk = 1; rk <= maxRk; rk++) set.add(`Ngăn ${pad2(rk)}`);
    booksList.forEach(b => {
      const p = parseLocation(b.location);
      if (p.rack) set.add(p.rack);
    });
    if (relocateRack) set.add(relocateRack);
    if (newBookRack) set.add(newBookRack);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [booksList, relocateRack, newBookRack, layoutConfig]);

  // Filter books by category, room, shelf, and Smart Fuzzy + Semantic Search Engine
  const smartSearchState = useMemo(() => {
    const preFiltered = booksList.filter((b) => {
      const matchesCategory =
        selectedCategoryFilter === "all" ||
        (b.category_id && b.category_id.toString() === selectedCategoryFilter) ||
        (b.category_name && b.category_name === selectedCategoryFilter);

      const parsed = parseLocation(b.location);
      const matchesRoom = selectedRoomFilter === "all" || parsed.room === selectedRoomFilter;
      const matchesShelf = selectedShelfFilter === "all" || parsed.shelf === selectedShelfFilter;

      return matchesCategory && matchesRoom && matchesShelf;
    });

    return runSmartBookSearch(preFiltered, q);
  }, [booksList, q, selectedCategoryFilter, selectedRoomFilter, selectedShelfFilter]);

  const filtered = smartSearchState.items;

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [q, selectedCategoryFilter, selectedRoomFilter, selectedShelfFilter]);

  // Pagination calculations for book catalog
  const totalBooks = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalBooks);
  const paginatedBooks = filtered.slice(startIndex, endIndex);

  const handlePageChange = (newPage: number) => {
    const targetPage = Math.min(Math.max(1, newPage), totalPages);
    setCurrentPage(targetPage);
    if (catalogTopRef.current) {
      catalogTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

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

  const handleClearFilters = () => {
    setQ("");
    setSelectedCategoryFilter("all");
    setSelectedRoomFilter("all");
    setSelectedShelfFilter("all");
    setCurrentPage(1);
  };

  const hasActiveFilters = q !== "" || selectedCategoryFilter !== "all" || selectedRoomFilter !== "all" || selectedShelfFilter !== "all";

  // Drilldown from Room / Category view to Catalog
  const handleFilterByRoomCategory = (roomName: string, categoryName: string) => {
    setSelectedRoomFilter(roomName);
    setSelectedCategoryFilter(categoryName);
    setSelectedShelfFilter("all");
    setCurrentPage(1);
    setActiveViewTab("catalog");
  };

  const handleFilterByRoomShelf = (roomName: string, shelfName: string) => {
    setSelectedRoomFilter(roomName);
    setSelectedShelfFilter(shelfName);
    setSelectedCategoryFilter("all");
    setCurrentPage(1);
    setActiveViewTab("catalog");
  };

  const handleFilterByCategoryOnly = (categoryName: string) => {
    setSelectedCategoryFilter(categoryName);
    setSelectedRoomFilter("all");
    setSelectedShelfFilter("all");
    setCurrentPage(1);
    setActiveViewTab("catalog");
  };

  // Download Sample Excel Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        "Tên sách": "Nhà Giả Kim",
        "Tác giả": "Paulo Coelho",
        "Thể loại": "Tiểu thuyết",
        "Nhà xuất bản": "NXB Hội Nhà Văn",
        "Mã ISBN": "978-604-1-88991-1",
        "Số lượng": 5,
        "Năm xuất bản": 2023,
        "Vị trí": "Phòng 03 - Kệ 05 - Ngăn 02",
        "Mô tả": "Tác phẩm kinh điển truyền cảm hứng về hành trình theo đuổi ước mơ."
      },
      {
        "Tên sách": "Nghệ Thuật Giao Tiếp Đỉnh Cao",
        "Tác giả": "Dale Carnegie",
        "Thể loại": "Kỹ năng & Phát triển",
        "Nhà xuất bản": "NXB Trẻ",
        "Mã ISBN": "978-604-1-77882-2",
        "Số lượng": 10,
        "Năm xuất bản": 2022,
        "Vị trí": "Phòng 02 - Kệ 01 - Ngăn 03",
        "Mô tả": "Nghệ thuật ứng xử và thu phục lòng người."
      },
      {
        "Tên sách": "Clean Code - Nghệ thuật viết mã sạch",
        "Tác giả": "Robert C. Martin",
        "Thể loại": "Khoa học & Công nghệ",
        "Nhà xuất bản": "NXB Tri Thức",
        "Mã ISBN": "978-013-2-35088-4",
        "Số lượng": 4,
        "Năm xuất bản": 2021,
        "Vị trí": "Phòng 03 - Kệ 03 - Ngăn 01",
        "Mô tả": "Cẩm nang hướng dẫn lập trình viên viết code sạch, dễ bảo trì."
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    worksheet["!cols"] = [
      { wch: 35 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
      { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 30 }, { wch: 45 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Mau_Nhap_Sach");
    XLSX.writeFile(workbook, "Mau_Nhap_Kho_Sach_Athenaeum.xlsx");
    toast.success("Đã tải file Excel mẫu về máy thành công!");
  };

  // Export current filtered books to Excel
  const handleExportToExcel = () => {
    if (filtered.length === 0) {
      toast.error("Không có dữ liệu sách để xuất file Excel");
      return;
    }

    const exportData = filtered.map((b, idx) => ({
      "STT": idx + 1,
      "Mã ID": b.id,
      "Tên đầu sách": b.title,
      "Tác giả": b.author_name || "Chưa cập nhật",
      "Thể loại": b.category_name || "Chưa cập nhật",
      "Mã ISBN": b.isbn || "Chưa cập nhật",
      "Vị trí lưu kho": b.location || "Phòng 01 - Kệ 01 - Ngăn 01",
      "Tổng bản sao": b.total_copies,
      "Bản sao còn sẵn": b.available_copies,
      "Mô tả": b.description || ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    worksheet["!cols"] = [
      { wch: 6 }, { wch: 8 }, { wch: 35 }, { wch: 22 },
      { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 35 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Kho_Sach");
    XLSX.writeFile(workbook, `Danh_Sach_Kho_Sach_Athenaeum_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Đã xuất ${filtered.length} đầu sách ra file Excel thành công!`);
  };

  // Handle Excel upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (!rawJson || rawJson.length === 0) {
          toast.error("File Excel không có dữ liệu");
          return;
        }

        const normalized = rawJson.map((row) => {
          const title = (row["Tên sách"] || row["Tên đầu sách"] || row["title"] || row["Title"] || row["name"] || "").toString().trim();
          const author = (row["Tác giả"] || row["author"] || row["Author"] || "").toString().trim();
          const category = (row["Thể loại"] || row["category"] || row["Category"] || "").toString().trim();
          const publisher = (row["Nhà xuất bản"] || row["NXB"] || row["publisher"] || row["Publisher"] || "").toString().trim();
          const isbn = (row["Mã ISBN"] || row["ISBN"] || row["isbn"] || "").toString().trim();
          const published_year = parseInt(row["Năm xuất bản"] || row["Năm XB"] || row["published_year"] || new Date().getFullYear(), 10) || new Date().getFullYear();
          const total_copies = parseInt(row["Số lượng"] || row["Số bản sao"] || row["total_copies"] || row["copies"] || 1, 10) || 1;
          const location = (row["Vị trí"] || row["Vị trí kho"] || row["location"] || "").toString().trim();
          const description = (row["Mô tả"] || row["description"] || "Sách nhập từ file Excel").toString().trim();
          const cover_image = (row["Hình ảnh"] || row["Ảnh bìa"] || row["cover_image"] || row["cover"] || "").toString().trim();

          return {
            title, author, category, publisher, isbn, published_year, total_copies, location, description, cover_image
          };
        }).filter(item => item.title.length > 0);

        if (normalized.length === 0) {
          toast.error("Không tìm thấy dòng sách hợp lệ");
          return;
        }

        setExcelParsedData(normalized);
        setIsExcelDialogOpen(true);
        toast.success(`Đã đọc ${normalized.length} đầu sách từ file "${file.name}"`);
      } catch (err) {
        console.error("Lỗi đọc file Excel:", err);
        toast.error("Không thể đọc file Excel");
      } finally {
        if (e.target) e.target.value = "";
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleConfirmBatchImport = async () => {
    if (excelParsedData.length === 0) return;
    setIsSubmittingImport(true);
    try {
      const response = await api.post("/books/import-batch", { books: excelParsedData });
      toast.success(response.data.message || `Đã nhập thành công ${excelParsedData.length} đầu sách!`);
      setIsExcelDialogOpen(false);
      setExcelParsedData([]);
      setExcelFileName("");
      fetchBooks();
      fetchMetadata();
    } catch (error: any) {
      console.error("Lỗi nhập sách:", error);
      toast.error(error.response?.data?.message || "Lỗi khi nhập sách vào hệ thống");
    } finally {
      setIsSubmittingImport(false);
    }
  };

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const response = await api.get("/books");
      const rawBooks = Array.isArray(response.data) ? response.data : [];
      const normalizedBooks = rawBooks.map((b: Book) => {
        const total = Math.max(0, Number(b.total_copies) || 0);
        const avail = Math.min(total, Math.max(0, Number(b.available_copies) || 0));
        return {
          ...b,
          total_copies: total,
          available_copies: avail,
        };
      });
      setBooksList(normalizedBooks);
    } catch (error) {
      console.error("Lỗi khi tải sách:", error);
      toast.error("Không thể kết nối tới server để tải sách");
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async () => {
    try {
      const [catRes, authRes, pubRes] = await Promise.all([
        api.get("/categories"),
        api.get("/authors"),
        api.get("/publishers")
      ]);
      setCategories(catRes.data || []);
      setAuthors(authRes.data || []);
      setPublishers(pubRes.data || []);
    } catch (error) {
      console.error("Lỗi khi tải dữ liệu phụ trợ:", error);
    }
  };

  const fetchUserStatus = async () => {
    if (user?.role !== "reader") return;
    try {
      const [reqRes, resvRes, draftRes] = await Promise.all([
        api.get("/borrow/requests"),
        api.get("/reservations"),
        api.get("/borrow/drafts/my-active")
      ]);
      setMyBorrowRequests(reqRes.data || []);
      setMyReservations(resvRes.data || []);
      setMyActiveDraft(draftRes.data?.draft || null);
    } catch (e) {
      console.error("Lỗi khi tải thông tin mượn / đặt trước:", e);
    }
  };

  useEffect(() => {
    fetchBooks();
    fetchMetadata();
    fetchUserStatus();
  }, [user]);

  const isBookInActiveDraft = (bookId: number) => {
    return Boolean(myActiveDraft?.items?.some((i: any) => i.book_id === bookId));
  };

  const handleCancelDraft = async (draftId: number) => {
    confirm({
      title: "Hủy phiếu mượn online này?",
      description: "Bạn có chắc chắn muốn hủy phiếu mượn online và nhả các cuốn sách đang giữ chỗ này không?",
      confirmText: "Hủy phiếu",
      cancelText: "Giữ lại",
      onConfirm: async () => {
        try {
          await api.delete(`/borrow/drafts/${draftId}`);
          toast.success("Đã hủy phiếu mượn online thành công");
          setIsDraftQrModalOpen(false);
          setMyActiveDraft(null);
          fetchBooks();
          fetchUserStatus();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể hủy phiếu mượn");
        }
      }
    });
  };

  const handleRemoveDraftItem = (itemId: number, bookTitle: string) => {
    confirm({
      title: "Xóa sách khỏi phiếu mượn?",
      description: `Bạn có chắc muốn xóa cuốn «${bookTitle}» khỏi phiếu mượn này? Suất giữ chỗ sẽ được trả lại cho kho thư viện.`,
      confirmText: "Xóa cuốn này",
      cancelText: "Giữ lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/borrow/drafts/items/${itemId}`);
          toast.success(`Đã xóa cuốn «${bookTitle}» khỏi phiếu mượn`);
          await fetchUserStatus();
          await fetchBooks();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể xóa sách khỏi phiếu");
        }
      }
    });
  };

  const handleUnverifyDraftItem = async (itemId: number, bookTitle: string) => {
    try {
      await api.post(`/borrow/drafts/items/${itemId}/unverify`);
      toast.success(`Đã gỡ mã đối soát cuốn «${bookTitle}». Bạn có thể quét lại mã bản sao khác!`);
      await fetchUserStatus();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể hủy đối soát");
    }
  };

  const handleDownloadDraftQr = (code: string) => {
    const canvas = document.getElementById("canvas-my-draft-qr") as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL("image/png");
    let downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `${code}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    toast.success(`Đã tải ảnh mã QR phiếu mượn (${code}.png) về máy`);
  };

  const handleCopyDraftCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Đã sao chép mã phiếu: ${code}`);
  };

  const handleOpenQrDialog = async (book: Book) => {
    setSelectedBookForQr(book);
    setQrDialogOpen(true);
    setLoadingQr(true);
    try {
      const res = await api.get(`/books/${book.id}`);
      if (res.data && res.data.copies) {
        setBookCopies(res.data.copies);
      } else {
        setBookCopies([]);
      }
      setActiveBookHolds(res.data?.active_holds || []);
    } catch (error) {
      console.error("Lỗi tải bản sao:", error);
      toast.error("Không thể tải mã QR của sách");
    } finally {
      setLoadingQr(false);
    }
  };

  const handleDownloadQr = (qrCodeStr: string) => {
    const canvas = document.getElementById(`qr-canvas-${qrCodeStr}`) as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL("image/png");
    let downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `${qrCodeStr}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    toast.success(`Đã tải ảnh mã QR (${qrCodeStr}.png) về máy`);
  };

  const handleRegisterBorrow = async (book: Book) => {
    const isAvailable = book.available_copies > 0;

    // Nếu sách đã nằm trong phiếu mượn nháp đang hoạt động, mở ngay modal QR phiếu mượn
    if (isBookInActiveDraft(book.id)) {
      setIsDraftQrModalOpen(true);
      return;
    }

    confirm({
      title: isAvailable
        ? "Đăng ký mượn online (Sinh Phiếu mượn nháp 24h)?"
        : "Đặt trước cuốn sách này (Xếp hàng đợi)?",
      description: isAvailable ? (
        <div className="space-y-3 text-left mt-1">
          <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground truncate">{book.title}</p>
              <p className="text-[11px] text-muted-foreground">
                📍 Vị trí kệ: <strong className="text-foreground">{book.location || "Phòng 01 - Kệ 01 - Ngăn 01"}</strong>
              </p>
            </div>
            <Badge className="bg-emerald-600 text-white text-[10px] shrink-0">
              Còn {book.available_copies} cuốn
            </Badge>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2.5 p-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-800/40">
              <span className="h-5 w-5 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="font-semibold text-indigo-950 dark:text-indigo-200">Tạo Phiếu mượn nháp & Khóa giữ chỗ 1 bản sao (24h)</p>
                <p className="text-[11px] text-muted-foreground">Hệ thống tự động khóa giữ riêng 1 suất bản sao trên kệ trong 24 giờ và sinh <strong>Phiếu mượn nháp</strong> cho bạn.</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-2 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/40">
              <span className="h-5 w-5 rounded-full bg-amber-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="font-semibold text-amber-950 dark:text-amber-200">Đến kệ tự lấy sách & Quét Tem Sách Tại Kệ</p>
                <p className="text-[11px] text-muted-foreground">Khi tới thư viện, bạn đến kệ lấy sách và bấm <strong>"Quét Tem Sách Tại Kệ"</strong> để ghi nhận mã bản sao vào phiếu nháp.</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/40">
              <span className="h-5 w-5 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="font-semibold text-emerald-950 dark:text-emerald-200">Tới quầy Thủ thư đối soát → Chuyển sang Phiếu mượn</p>
                <p className="text-[11px] text-muted-foreground">Đưa mã <strong>Phiếu mượn nháp</strong> hoặc <strong>Thẻ độc giả</strong> để Thủ thư quét đối soát chuyển sang <strong>Phiếu mượn chính thức</strong> (hạn 14 ngày).</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-left mt-1">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground truncate">{book.title}</p>
              <p className="text-[11px] text-muted-foreground">
                📍 Vị trí kệ: <strong className="text-foreground">{book.location || "Phòng 01 - Kệ 01 - Ngăn 01"}</strong>
              </p>
            </div>
            <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[10px] shrink-0 font-bold">
              0/{book.total_copies} cuốn trên kệ
            </Badge>
          </div>

          {book.wait_prediction ? (
            <div className="rounded-xl border-2 border-amber-500/45 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-transparent p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-amber-900 dark:text-amber-200">
                  <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                  Dự Báo Ngày Có Sách (Smart Wait-Time Predictor)
                </span>
                <Badge className="bg-amber-600 text-white text-[10px] font-bold">
                  Vị trí #{book.wait_prediction.queue_position}
                </Badge>
              </div>
              <p className="text-xs font-semibold text-foreground leading-relaxed">
                ⏳ Dự kiến có sách sau{" "}
                <strong className="text-amber-700 dark:text-amber-300 underline">
                  ~{book.wait_prediction.estimated_wait_days} ngày nữa
                </strong>{" "}
                (vào khoảng <strong>{book.wait_prediction.expected_date_vn}</strong>)
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div className="p-2 rounded-lg bg-background/80 border border-amber-500/25">
                  <span className="text-muted-foreground block text-[10px]">Bản sao hoàn trả sớm nhất:</span>
                  <span className="font-bold text-foreground">{book.wait_prediction.earliest_due_date_vn}</span>
                </div>
                <div className="p-2 rounded-lg bg-background/80 border border-amber-500/25">
                  <span className="text-muted-foreground block text-[10px]">Thứ tự của bạn nếu đặt ngay:</span>
                  <span className="font-bold text-amber-700 dark:text-amber-300">
                    Đứng thứ #{book.wait_prediction.queue_position} trong hàng chờ
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground leading-relaxed">
            Ngay khi độc giả đang mượn hoàn trả bản sao về thư viện, hệ thống sẽ <strong>ưu tiên giữ sách riêng 48h</strong> cho bạn và gửi thông báo tự động!
          </p>
        </div>
      ),
      confirmText: isAvailable ? "Xác nhận & Giữ chỗ 24h" : "Xác nhận xếp hàng",
      cancelText: "Hủy bỏ",
      onConfirm: async () => {
        try {
          if (isAvailable) {
            const res = await api.post("/borrow/drafts", { bookIds: [book.id] });
            toast.success(res.data.message || "Đã đăng ký mượn online và tạo mã QR phiếu mượn thành công!");
            if (res.data?.draft) {
              setMyActiveDraft(res.data.draft);
            }
            setIsDraftQrModalOpen(true);
          } else {
            const res = await api.post("/reservations", { bookId: book.id });
            toast.success(res.data.message || "Đã ghi nhận đặt trước vào hàng đợi!");
          }
          fetchBooks();
          fetchUserStatus();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể thực hiện yêu cầu này");
        }
      }
    });
  };

  const handleAddBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Vui lòng nhập tên sách");
      return;
    }

    const finalNewLocation = newLocation.trim() || `${newBookRoom} - ${newBookShelf} - ${newBookRack}`;

    confirm({
      title: "Xác nhận thêm mới đầu sách",
      description: `Bạn có đồng ý thêm đầu sách "${newTitle}" (${newCopies} bản sao) tại vị trí "${finalNewLocation}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await api.post("/books", {
            title: newTitle,
            author_id: selectedAuthor ? parseInt(selectedAuthor) : null,
            publisher_id: selectedPublisher ? parseInt(selectedPublisher) : null,
            category_id: selectedCategory ? parseInt(selectedCategory) : null,
            isbn: newIsbn,
            location: finalNewLocation,
            total_copies: newCopies,
            published_year: new Date().getFullYear(),
            description: "Mô tả sách thư viện",
          });

          toast.success("Thêm đầu sách mới và tạo mã QR thành công!");
          setIsDialogOpen(false);
          setNewTitle("");
          setSelectedAuthor("");
          setSelectedPublisher("");
          setSelectedCategory("");
          setNewIsbn("");
          setNewLocation("");
          setNewCopies(1);
          fetchBooks();
        } catch (error) {
          console.error("Lỗi khi thêm sách:", error);
          toast.error("Lỗi khi thêm đầu sách mới");
        }
      }
    });
  };

  const handleDeleteBook = (id: number, bookTitle: string) => {
    confirm({
      title: "Xác nhận xóa đầu sách",
      description: `Bạn có đồng ý xóa đầu sách "${bookTitle}" không? Các bản sao sách và mã QR tương ứng cũng sẽ bị xóa.`,
      confirmText: "Đồng ý xóa",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/books/${id}`);
          toast.success("Xóa sách thành công");
          fetchBooks();
        } catch (error) {
          console.error("Lỗi khi xóa sách:", error);
          toast.error("Không thể xóa sách");
        }
      }
    });
  };

  // Summary counts
  const totalBooksCount = booksList.length;
  const totalCopiesCount = booksList.reduce((acc, b) => acc + (b.total_copies || 0), 0);
  const availableCopiesCount = booksList.reduce((acc, b) => acc + (b.available_copies || 0), 0);
  const borrowedCopiesCount = Math.max(0, totalCopiesCount - availableCopiesCount);

  return (
    <div className="space-y-6">
      {/* Top Overview Metric Cards: Sách & Bản sao QR */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Tổng số đầu sách</p>
              <p className="text-2xl font-bold font-display text-primary mt-1">{loading ? "..." : totalBooksCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Tác phẩm trong thư viện</p>
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-emerald-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Tổng số bản sao (QR)</p>
              <p className="text-2xl font-bold font-display text-emerald-600 mt-1">{loading ? "..." : totalCopiesCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Quyển sách vật lý trong kho</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
              <QrCode className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-blue-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Bản sao sẵn sàng</p>
              <p className="text-2xl font-bold font-display text-blue-600 mt-1">{loading ? "..." : availableCopiesCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Trên kệ chờ độc giả</p>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Đang cho mượn</p>
              <p className="text-2xl font-bold font-display text-amber-600 mt-1">{loading ? "..." : borrowedCopiesCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Độc giả đang giữ đọc</p>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600">
              <Building className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Borrow Draft Banner for Readers */}
      {user?.role === "reader" && myActiveDraft && (() => {
        const bannerPickPath = optimizeMultiBookPickPath(myActiveDraft.items || []);
        return (
        <div className="relative overflow-hidden rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-indigo-500/10 via-card to-emerald-500/10 p-4 shadow-xs space-y-3">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-xs shrink-0">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-sm sm:text-base text-indigo-800 dark:text-indigo-300">
                    Phiếu Mượn Nháp (Giữ Chỗ Online 24h & Lộ Trình Đi Lấy Sách Tối Ưu)
                  </h3>
                  <Badge className="font-mono text-xs bg-indigo-600 text-white">
                    {myActiveDraft.draft_code}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs gap-1 font-semibold ${
                      myActiveDraft.all_verified
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                        : "bg-amber-50 text-amber-800 border-amber-300"
                    }`}
                  >
                    {myActiveDraft.all_verified
                      ? `✓ Đã quét tại kệ (${myActiveDraft.verified_count || 0}/${myActiveDraft.total_count || myActiveDraft.items?.length || 1} cuốn)`
                      : `Chờ quét tại kệ (${myActiveDraft.verified_count || 0}/${myActiveDraft.total_count || myActiveDraft.items?.length || 1} cuốn)`}
                  </Badge>
                  <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 text-xs gap-1">
                    <Clock className="h-3 w-3 text-amber-600" />
                    Còn {myActiveDraft.time_left_hours != null ? `${myActiveDraft.time_left_hours} giờ` : "24 giờ"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                  {myActiveDraft.all_verified ? (
                    <>
                      Bạn đã tự lấy sách và quét tem tại kệ. Hãy tới quầy xuất trình <strong>Mã Phiếu mượn nháp</strong> hoặc <strong>Thẻ độc giả</strong> để Thủ thư quét đối soát chuyển sang <strong>Phiếu mượn chính thức</strong>!
                    </>
                  ) : (
                    <>
                      Hệ thống đã khóa giữ riêng <strong>{bannerPickPath.orderedItems.length || 1} suất bản sao</strong> trong 24 giờ và tự động sắp xếp <strong>Lộ trình đi lấy sách tối ưu</strong> (Phòng gần sảnh → Kệ thấp đến cao → Ngăn dưới lên trên).
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto shrink-0 flex-wrap">
              {!myActiveDraft.all_verified && (
                <Button
                  type="button"
                  className="flex-1 md:flex-initial gap-1.5 font-semibold text-xs h-9 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  onClick={() => navigate("/borrow?scan=shelf")}
                >
                  <Camera className="h-4 w-4" />
                  Quét Tem Sách Tại Kệ
                </Button>
              )}
              <Button
                type="button"
                className="flex-1 md:flex-initial gap-1.5 font-semibold text-xs h-9 shadow-xs bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                onClick={() => setIsDraftQrModalOpen(true)}
              >
                <QrCode className="h-4 w-4" />
                Xem Lộ Trình & Phiếu Nháp ({bannerPickPath.orderedItems.length || 1} cuốn)
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 text-xs h-9 cursor-pointer"
                onClick={() => handleCancelDraft(myActiveDraft.id)}
                title="Hủy phiếu mượn nháp này nếu không muốn mượn nữa"
              >
                <X className="h-4 w-4" />
                Hủy phiếu
              </Button>
            </div>
          </div>

          {bannerPickPath.orderedItems.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-indigo-500/20 text-[11px]">
              <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] shrink-0 gap-1">
                <Compass className="h-3 w-3" /> Lộ trình tối ưu:
              </Badge>
              <span className="px-2 py-0.5 rounded-md bg-background border font-semibold shrink-0">
                🏁 Sảnh chính
              </span>
              {bannerPickPath.orderedItems.map((item: any) => {
                const loc = item._pickPath.parsedLocation;
                const isVerified = Boolean(item.book_copy_id);
                return (
                  <div key={`banner-stop-${item.item_id || item.book_id || item._pickPath.stepOrder}`} className="flex items-center gap-1 shrink-0">
                    <ArrowRight className="h-3 w-3 text-emerald-600 shrink-0" />
                    <button
                      type="button"
                      onClick={() => handleOpenMiniMap({ location: item.location, title: item.book_title, cover: item.cover_image })}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-left transition-colors cursor-pointer ${
                        isVerified
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-background hover:bg-emerald-50 border-emerald-500/40 text-foreground"
                      }`}
                      title={`Chặng ${item._pickPath.stepOrder}: ${item.book_title} (${loc.formatted}) — Bấm mở bản đồ 2D`}
                    >
                      <span className={`font-bold text-[10px] ${isVerified ? "text-white" : "text-emerald-700"}`}>
                        #{item._pickPath.stepOrder}
                      </span>
                      <span className="font-semibold whitespace-nowrap">
                        {loc.roomLabel} • {loc.shelfLabel} • {loc.rackLabel}
                      </span>
                      <span className={`truncate max-w-[110px] ${isVerified ? "text-indigo-100" : "text-muted-foreground"}`}>
                        ({item.book_title})
                      </span>
                    </button>
                  </div>
                );
              })}
              <ArrowRight className="h-3 w-3 text-indigo-600 shrink-0" />
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                💁 Quầy Thủ thư
              </span>
            </div>
          )}
        </div>
        );
      })()}

      {/* Main View Mode Switcher: 3 Chế Độ Quản Lý & Tra Cứu */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-muted/40 p-1.5 rounded-2xl border border-border/70 backdrop-blur-xs">
        <div className="grid grid-cols-3 sm:flex items-center gap-1.5 w-full sm:w-auto">
          <Button
            type="button"
            variant={activeViewTab === "catalog" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveViewTab("catalog")}
            className="text-xs gap-1.5 rounded-xl h-9 font-semibold justify-center sm:justify-start transition-all"
          >
            <Grid3X3 className="h-4 w-4 shrink-0" />
            <span className="truncate">Danh mục sách</span>
            <Badge variant="secondary" className="hidden md:inline-flex ml-1 text-[10px] px-1.5 py-0 h-4">
              {booksList.length}
            </Badge>
          </Button>

          <Button
            type="button"
            variant={activeViewTab === "rooms" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveViewTab("rooms")}
            className="text-xs gap-1.5 rounded-xl h-9 font-semibold justify-center sm:justify-start transition-all"
          >
            <Building className="h-4 w-4 shrink-0 text-foreground" />
            <span className="truncate">Sơ đồ Phòng & Kệ</span>
            <Badge variant="secondary" className="hidden md:inline-flex ml-1 text-[10px] px-1.5 py-0 h-4">
              {spatialRooms.length} phòng
            </Badge>
          </Button>

          <Button
            type="button"
            variant={activeViewTab === "categories" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveViewTab("categories")}
            className="text-xs gap-1.5 rounded-xl h-9 font-semibold justify-center sm:justify-start transition-all"
          >
            <FolderTree className="h-4 w-4 shrink-0" />
            <span className="truncate">Thể loại ⇄ Vị trí</span>
            <Badge variant="secondary" className="hidden md:inline-flex ml-1 text-[10px] px-1.5 py-0 h-4">
              {categories.length}
            </Badge>
          </Button>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 text-xs text-muted-foreground px-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            Ký hiệu: Phòng - Kệ - Ngăn
          </span>
          {canManage && (
            <Button
              type="button"
              size="sm"
              onClick={() => handleOpenShelfAudit("Phòng 01 - Kệ 01 - Ngăn 01")}
              className="h-7 text-[11px] gap-1.5 px-2.5 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer"
              title="Kiểm kê kho sách nhanh bằng quét QR hàng loạt (Smart Shelf Inventory Audit)"
            >
              <Scan className="h-3.5 w-3.5" /> Kiểm kê kệ QR
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleOpenMiniMap({ location: "Phòng 01 - Kệ 01 - Ngăn 01" })}
            className="h-7 text-[11px] gap-1 px-2.5 font-medium border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
          >
            <Compass className="h-3.5 w-3.5" /> Mở Mini Map Tổng
          </Button>
        </div>
      </div>

      {/* VIEW 1: DANH MỤC ĐẦU SÁCH (CATALOG VIEW VỚI BỘ LỌC PHÒNG & KỆ SÂU) */}
      {activeViewTab === "catalog" && (
        <div className="space-y-4">
          {/* Header filter controls */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
              {/* Search text input */}
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                  value={q} 
                  onChange={(e) => setQ(e.target.value)} 
                  placeholder="Tìm theo tên sách, tác giả, thể loại, ISBN, vị trí…" 
                  className="pl-9 pr-9 text-sm h-10" 
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      setCurrentPage(1);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground rounded-full p-0.5 cursor-pointer"
                    title="Xóa từ khóa tìm kiếm"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filter controls row */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Category select */}
                <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                  <SelectTrigger className="w-[145px] sm:w-[160px] text-xs h-10">
                    <SelectValue placeholder="Tất cả thể loại" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả thể loại</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Spatial Room select */}
                <Select value={selectedRoomFilter} onValueChange={(val) => {
                  setSelectedRoomFilter(val);
                  setSelectedShelfFilter("all");
                }}>
                  <SelectTrigger className="w-[130px] sm:w-[145px] text-xs h-10">
                    <SelectValue placeholder="Tất cả phòng" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả phòng</SelectItem>
                    {availableRooms.map((r) => (
                      <SelectItem key={r} value={r}>
                        🏢 {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Spatial Shelf select */}
                <Select 
                  value={selectedShelfFilter} 
                  onValueChange={setSelectedShelfFilter}
                >
                  <SelectTrigger className="w-[125px] sm:w-[135px] text-xs h-10">
                    <SelectValue placeholder="Tất cả kệ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả kệ</SelectItem>
                    {availableShelves.map((s) => (
                      <SelectItem key={s} value={s}>
                        📚 {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Admin / Librarian Buttons */}
                {canManage && (
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <Button 
                      variant="outline" 
                      onClick={handleExportToExcel}
                      size="sm"
                      className="h-10 gap-1.5 shrink-0 border-emerald-500/30 text-emerald-600 hover:bg-emerald-50 text-xs font-medium dark:hover:bg-emerald-950/30"
                      title="Xuất danh sách sách ra file Excel"
                    >
                      <FileSpreadsheet className="h-4 w-4" /> <span className="hidden sm:inline">Xuất</span> Excel
                    </Button>

                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      accept=".xlsx, .xls, .csv" 
                      className="hidden" 
                    />

                    <Button 
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      size="sm"
                      className="h-10 gap-1.5 shrink-0 border-primary/40 text-primary hover:bg-primary/10 text-xs font-medium"
                      title="Tải file Excel để nhập sách hàng loạt"
                    >
                      <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Nhập</span> Excel
                    </Button>

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" className="h-10 gap-1.5 shrink-0 shadow-xs text-xs font-medium">
                          <Plus className="h-4 w-4" /> Thêm sách
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle className="font-display">Thêm đầu sách mới vào kho</DialogTitle>
                          <DialogDescription className="text-xs">
                            Điền thông tin sách. Mã QR cho từng bản sao sẽ được hệ thống tự động sinh.
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleAddBook} className="space-y-3 pt-2">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Tên đầu sách *</label>
                            <Input placeholder="Nhập tên sách..." value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required className="text-sm mt-1" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Mã ISBN</label>
                            <Input placeholder="VD: 978-604-1-15234-8" value={newIsbn} onChange={(e) => setNewIsbn(e.target.value)} className="text-sm mt-1" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Tác giả</label>
                              <Select value={selectedAuthor} onValueChange={setSelectedAuthor}>
                                <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Chọn tác giả" /></SelectTrigger>
                                <SelectContent>
                                  {authors.map((a) => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Nhà xuất bản</label>
                              <Select value={selectedPublisher} onValueChange={setSelectedPublisher}>
                                <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Chọn NXB" /></SelectTrigger>
                                <SelectContent>
                                  {publishers.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Số lượng bản sao</label>
                              <Input placeholder="Số lượng" type="number" value={newCopies} onChange={(e) => setNewCopies(parseInt(e.target.value) || 1)} min={1} className="text-sm mt-1" />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Thể loại</label>
                              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                                <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Chọn thể loại" /></SelectTrigger>
                                <SelectContent>
                                  {categories.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2 pt-1 border-t">
                            <label className="text-xs font-semibold text-foreground block">
                              Vị trí lưu kho (Chọn hoặc Thêm Phòng • Kệ • Ngăn)
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              {/* Room Picker */}
                              <div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-muted-foreground">Phòng</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const maxNum = dynamicRoomOptions.reduce((m, r) => {
                                        const n = parseInt(r.match(/\d+/)?.[0] || "0", 10);
                                        return Math.max(m, n);
                                      }, 3);
                                      const nextNum = maxNum + 1;
                                      const nextLabel = `Phòng ${pad2(nextNum)}`;
                                      setNewBookRoom(nextLabel);
                                      handleAddRoomToLibrary();
                                    }}
                                    className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                                  >
                                    + Thêm phòng
                                  </button>
                                </div>
                                <Select value={newBookRoom} onValueChange={setNewBookRoom}>
                                  <SelectTrigger className="text-xs mt-1 h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {dynamicRoomOptions.map((rm) => (
                                      <SelectItem key={rm} value={rm}>{rm}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Shelf Picker */}
                              <div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-muted-foreground">Kệ sách</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const maxNum = dynamicShelfOptions.reduce((m, s) => {
                                        const n = parseInt(s.match(/\d+/)?.[0] || "0", 10);
                                        return Math.max(m, n);
                                      }, 6);
                                      const nextNum = maxNum + 1;
                                      const nextLabel = `Kệ ${pad2(nextNum)}`;
                                      setNewBookShelf(nextLabel);
                                      toast.info(`Đã thêm & chọn ${nextLabel}`);
                                    }}
                                    className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                                  >
                                    + Thêm kệ
                                  </button>
                                </div>
                                <Select value={newBookShelf} onValueChange={setNewBookShelf}>
                                  <SelectTrigger className="text-xs mt-1 h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {dynamicShelfOptions.map((sh) => (
                                      <SelectItem key={sh} value={sh}>{sh}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Rack Picker */}
                              <div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-muted-foreground">Ngăn (Tầng)</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const maxNum = dynamicRackOptions.reduce((m, rk) => {
                                        const n = parseInt(rk.match(/\d+/)?.[0] || "0", 10);
                                        return Math.max(m, n);
                                      }, 5);
                                      const nextNum = maxNum + 1;
                                      const nextLabel = `Ngăn ${pad2(nextNum)}`;
                                      setNewBookRack(nextLabel);
                                      toast.info(`Đã thêm & chọn ${nextLabel}`);
                                    }}
                                    className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                                  >
                                    + Thêm ngăn
                                  </button>
                                </div>
                                <Select value={newBookRack} onValueChange={setNewBookRack}>
                                  <SelectTrigger className="text-xs mt-1 h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {dynamicRackOptions.map((rk) => (
                                      <SelectItem key={rk} value={rk}>{rk}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Vị trí sẽ lưu: <strong className="text-primary font-mono">{newBookRoom} - {newBookShelf} - {newBookRack}</strong>
                            </p>
                          </div>
                          <Button type="submit" className="w-full mt-2 font-semibold">Lưu & Sinh Mã QR Bản Sao</Button>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </div>
            </div>

            {/* Active Filters Summary Chips Bar & Top Pagination Status */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-1 px-1 text-xs text-muted-foreground">
              {hasActiveFilters ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 font-medium">
                    <SlidersHorizontal className="h-3 w-3" /> Đang lọc:
                  </span>

                  {selectedRoomFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 text-xs py-0.5 font-medium bg-primary/10 text-primary border border-primary/20">
                      🏢 {selectedRoomFilter}
                      <button 
                        onClick={() => {
                          setSelectedRoomFilter("all");
                          setSelectedShelfFilter("all");
                          setCurrentPage(1);
                        }}
                        className="hover:text-destructive rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}

                  {selectedShelfFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 text-xs py-0.5 font-medium bg-primary/10 text-primary border border-primary/20">
                      📚 {selectedShelfFilter}
                      <button 
                        onClick={() => {
                          setSelectedShelfFilter("all");
                          setCurrentPage(1);
                        }}
                        className="hover:text-destructive rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}

                  {selectedCategoryFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 text-xs py-0.5 font-medium bg-primary/10 text-primary border border-primary/20">
                      🏷️ {selectedCategoryFilter}
                      <button 
                        onClick={() => {
                          setSelectedCategoryFilter("all");
                          setCurrentPage(1);
                        }}
                        className="hover:text-destructive rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}

                  {q && (
                    <Badge variant="secondary" className="gap-1 text-xs py-0.5 font-medium bg-muted text-foreground border">
                      “{q}”
                      <button 
                        onClick={() => {
                          setQ("");
                          setCurrentPage(1);
                        }}
                        className="hover:text-destructive rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Xóa tất cả
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                  <span>Danh mục toàn bộ sách trong kho thư viện</span>
                </div>
              )}

              <div className="flex items-center gap-2 ml-auto">
                <span>
                  Hiển thị <strong>{totalBooks > 0 ? startIndex + 1 : 0} - {endIndex}</strong> / <strong>{totalBooks}</strong> đầu sách
                </span>
                {totalPages > 1 && (
                  <Badge variant="outline" className="text-[11px] font-mono py-0 px-2 bg-background border-primary/30 text-primary font-semibold">
                    Trang {validCurrentPage}/{totalPages}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Anchor to scroll smoothly when navigating pages */}
          <div ref={catalogTopRef} className="scroll-mt-6" />

          {/* Book cards grid */}
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 border rounded-2xl bg-muted/20">
              <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="font-semibold text-sm">Không tìm thấy đầu sách nào phù hợp</p>
              <p className="text-xs text-muted-foreground mt-1">
                {hasActiveFilters 
                  ? "Hãy thử bỏ bớt bộ lọc phòng, kệ hoặc thể loại để xem nhiều kết quả hơn." 
                  : "Chưa có đầu sách nào trong hệ thống."}
              </p>
              {hasActiveFilters && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleClearFilters}
                  className="mt-3 text-xs"
                >
                  Xóa bộ lọc để xem toàn bộ sách
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginatedBooks.map((b) => (
                <Card key={b.id} className="group overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border flex flex-col justify-between">
                  <div>
                    {/* Book cover area */}
                    <div 
                      onClick={() => handleOpenBookDetail(b)}
                      className="relative h-44 bg-gradient-to-br from-primary/10 via-accent/30 to-terracotta/10 overflow-hidden flex items-center justify-center cursor-pointer"
                      title="Nhấn để xem tóm tắt và chi tiết sách"
                    >
                      {b.cover_image ? (
                        <img 
                          src={b.cover_image} 
                          alt={b.title} 
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" 
                        />
                      ) : (
                        <div className="text-5xl select-none">📚</div>
                      )}

                      <Badge className="absolute top-2.5 left-2.5 bg-background/90 text-foreground border-0 shadow-xs text-[10px]">
                        {b.category_name || "Mặc định"}
                      </Badge>

                      {canManage && (
                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenRelocate(b);
                            }} 
                            title="Điều chuyển vị trí sách sang phòng/kệ khác (Thủ thư)"
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/90 shadow-sm transition-transform hover:scale-110 cursor-pointer text-foreground hover:text-primary"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenQrDialog(b);
                            }} 
                            title="Quản lý mã QR in dán sách (Thủ thư)"
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/90 shadow-sm transition-transform hover:scale-110 cursor-pointer text-foreground"
                          >
                            <QrCode className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    <CardContent className="p-4 space-y-2.5">
                      <div>
                        <h3 
                          onClick={() => handleOpenBookDetail(b)}
                          className="font-display text-sm font-bold leading-snug line-clamp-1 group-hover:text-primary transition-colors cursor-pointer"
                          title={b.title}
                        >
                          {b.title}
                        </h3>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          ✍️ {b.author_name || "Khuyết danh"}
                        </p>
                      </div>

                      {/* Book description preview */}
                      <div 
                        onClick={() => handleOpenBookDetail(b)}
                        className="cursor-pointer bg-muted/40 hover:bg-muted/70 p-2 rounded-lg border border-border/50 transition-colors"
                        title="Nhấn để xem đầy đủ nội dung tóm tắt"
                      >
                        <p className="text-[11px] text-muted-foreground line-clamp-2 italic leading-relaxed">
                          {b.description ? `“${b.description}”` : "Chưa có mô tả tóm tắt. Bấm để xem chi tiết."}
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t">
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span className="font-semibold text-[11px]">
                            {b.avg_rating && parseFloat(b.avg_rating as string) > 0 
                              ? parseFloat(b.avg_rating as string).toFixed(1) 
                              : "Chưa có"}
                          </span>
                          {b.review_count !== undefined && b.review_count > 0 && (
                            <span className="text-[10px] text-muted-foreground">({b.review_count})</span>
                          )}
                        </div>
                        <span className={b.available_copies > 0 ? "text-emerald-600 font-semibold text-[11px]" : "text-destructive font-semibold text-[11px]"}>
                          {b.available_copies > 0 ? `Còn ${b.available_copies}/${b.total_copies} cuốn` : `Hết sách (0/${b.total_copies} cuốn)`}
                        </span>
                      </div>

                      {/* Smart Wait-Time Predictor Box when book is out of stock */}
                      {b.available_copies <= 0 && b.wait_prediction && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] space-y-0.5">
                          <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                            <Clock className="h-3 w-3 text-amber-600 shrink-0" />
                            <span>Dự kiến có sách sau ~{b.wait_prediction.estimated_wait_days} ngày nữa</span>
                          </div>
                          <p className="text-[10px] text-amber-900/85 dark:text-amber-200/85 leading-snug">
                            Bản sao sớm nhất sẽ hoàn trả vào <strong>{b.wait_prediction.earliest_due_date_vn}</strong> • Bạn đứng thứ <strong>#{b.wait_prediction.queue_position}</strong> trong hàng chờ
                          </p>
                        </div>
                      )}

                      {user?.role !== "reader" && (() => {
                        const bookHoldCount = myBorrowRequests.filter(r => r.book_id === b.id && r.status === 'pending').length;
                        if (bookHoldCount <= 0) return null;
                        return (
                          <div className="pt-0.5">
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold gap-1 w-full justify-center">
                              <Clock className="h-3 w-3 text-amber-600" />
                              Có {bookHoldCount} cuốn đang giữ chỗ 24h
                            </Badge>
                          </div>
                        );
                      })()}

                      {/* Neutral Location badge with Mini Map trigger */}
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenMiniMap(b);
                        }}
                        className="flex items-center justify-between text-[11px] text-muted-foreground bg-muted/40 hover:bg-muted/80 px-2.5 py-1.5 rounded-lg border border-border/60 transition-colors cursor-pointer group/loc"
                        title="Nhấn để xem sơ đồ Mini Map chỉ đường đến kệ sách"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-xs">📍</span>
                          <span className="font-medium text-foreground truncate" title={b.location || "Phòng 01 - Kệ 01 - Ngăn 01"}>
                            {b.location || "Phòng 01 - Kệ 01 - Ngăn 01"}
                          </span>
                        </div>
                        <span className="text-[10px] text-primary font-semibold flex items-center gap-0.5 opacity-90 group-hover/loc:translate-x-0.5 transition-transform shrink-0 ml-1">
                          🗺️ Bản đồ
                        </span>
                      </div>

                      <p className="font-mono text-[10px] text-muted-foreground truncate">
                        ISBN: {b.isbn || "Chưa cập nhật"}
                      </p>
                    </CardContent>
                  </div>

                    {/* Card action buttons */}
                  <div className="p-4 pt-0 space-y-2">
                    {user?.role === "reader" ? (
                      <div className="space-y-1.5">
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="w-full text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 h-8 font-medium"
                          onClick={() => handleOpenBookDetail(b)}
                        >
                          <Eye className="h-3.5 w-3.5" /> Xem chi tiết
                        </Button>
                        
                        {isBookInActiveDraft(b.id) ? (
                          <Button 
                            size="sm" 
                            className="w-full text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs h-8"
                            title="Cuốn sách này đang có trong phiếu mượn online 24h của bạn. Bấm để xem mã QR giao dịch cho Thủ thư quét."
                            onClick={() => setIsDraftQrModalOpen(true)}
                          >
                            <QrCode className="h-3.5 w-3.5" /> 
                            Đã giữ chỗ 24h • Xem mã QR
                          </Button>
                        ) : myReservations.some(r => r.book_id === b.id && ['waiting', 'pending', 'notified', 'ready', 'accepted'].includes(r.status)) ? (
                          <Button 
                            size="sm" 
                            variant="outline"
                            disabled
                            className="w-full text-xs gap-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold h-8 cursor-default"
                          >
                            <Clock className="h-3.5 w-3.5 text-amber-600" /> 
                            Đang đặt trước sách
                          </Button>
                        ) : b.available_copies > 0 ? (
                          <Button 
                            size="sm" 
                            className="w-full text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs h-8"
                            title="Đăng ký mượn online, giữ chỗ 24h và tạo mã QR phiếu mượn cho thủ thư quét"
                            onClick={() => handleRegisterBorrow(b)}
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" /> 
                            Đăng ký mượn online
                          </Button>
                        ) : (
                          <Button 
                            size="sm" 
                            className="w-full text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs h-8 animate-in fade-in"
                            title="Đầu sách đã hết bản sao, bấm để xếp hàng đặt trước khi có sách hoàn trả"
                            onClick={() => handleRegisterBorrow(b)}
                          >
                            <Clock className="h-3.5 w-3.5" /> 
                            Hết sách • Đặt trước
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10 h-8 font-medium"
                            onClick={() => handleOpenBookDetail(b)}
                          >
                            <Eye className="h-3.5 w-3.5" /> Chi tiết
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="text-xs gap-1 border-border hover:bg-muted h-8 font-medium"
                            onClick={() => handleOpenRelocate(b)}
                            title="Đổi phòng, kệ hoặc ngăn lưu kho cho sách này"
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" /> Đổi vị trí
                          </Button>
                        </div>
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="w-full text-xs gap-1.5 shadow-xs h-8"
                          onClick={() => handleOpenQrDialog(b)}
                        >
                          <QrCode className="h-3.5 w-3.5" /> Quản lý mã QR bản sao
                        </Button>
                      </div>
                    )}

                    {canManage && (
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                        <Button size="sm" variant="ghost" className="flex-1 text-xs h-7 gap-1 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteBook(b.id, b.title)}>
                          <Trash2 className="h-3 w-3" /> Xóa đầu sách
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {/* Thanh Phân Trang Hiện Đại & Tinh Gọn (Pagination Bar: Trang 1, 2, 3...) */}
            {totalBooks > 0 && (
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-3.5 bg-card border border-border/80 rounded-2xl shadow-xs mt-3">
                {/* Phía trái: Bộ đếm số lượng & Tùy chọn số sách mỗi trang */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground w-full md:w-auto justify-between md:justify-start">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>
                      Đang xem <strong>{startIndex + 1} - {endIndex}</strong> / <strong>{totalBooks}</strong> đầu sách
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 border-l pl-3 border-border/80">
                    <span className="text-[11px] whitespace-nowrap">Hiển thị:</span>
                    <Select
                      value={pageSize.toString()}
                      onValueChange={(val) => {
                        setPageSize(parseInt(val, 10));
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="h-8 w-[95px] text-xs bg-background shadow-2xs font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8">8 / trang</SelectItem>
                        <SelectItem value="12">12 / trang</SelectItem>
                        <SelectItem value="16">16 / trang</SelectItem>
                        <SelectItem value="24">24 / trang</SelectItem>
                        <SelectItem value="48">48 / trang</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Phía phải: Cụm điều hướng số trang (Trang 1, 2, 3...) */}
                {totalPages > 1 && (
                  <div className="flex items-center gap-1 flex-wrap justify-center">
                    {/* Nút về trang đầu tiên */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(1)}
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
                      onClick={() => handlePageChange(validCurrentPage - 1)}
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
                            onClick={() => handlePageChange(pageNum)}
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
                      onClick={() => handlePageChange(validCurrentPage + 1)}
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
                      onClick={() => handlePageChange(totalPages)}
                      disabled={validCurrentPage === totalPages}
                      className="h-8 w-8 p-0 text-xs hidden sm:flex border-border/80 hover:bg-muted"
                      title={`Đến trang cuối (Trang ${totalPages})`}
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* VIEW 2: SƠ ĐỒ PHÒNG & KỆ SÁCH (SPATIAL ROOM & SHELF DIRECTORY) */}
      {activeViewTab === "rooms" && (
        <div className="space-y-6">
          {/* Explanation Header */}
          <div className="bg-gradient-to-r from-primary/5 via-accent/10 to-primary/5 border border-primary/20 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-display font-bold text-base sm:text-lg flex items-center gap-2 text-foreground">
                  <Building className="h-5 w-5 text-primary" /> Sơ Đồ Không Gian Lưu Kho Thư Viện (Phòng • Kệ • Ngăn)
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">
                  Quản lý trực tiếp từng <strong>Phòng</strong>, thêm/bớt <strong>Kệ sách</strong> trong từng phòng và thêm/bớt <strong>Ngăn (Tầng)</strong> trên từng kệ. Mọi thay đổi sẽ tự động đồng bộ ngay lập tức với <strong>Sơ đồ Mini Map dẫn đường</strong> của độc giả.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {canManage && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddRoomToLibrary}
                      className="text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      Thêm Phòng Mới ({`Phòng ${pad2(spatialRooms.length + 1)}`})
                    </Button>
                    {spatialRooms.length > 3 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const lastRm = spatialRooms[spatialRooms.length - 1];
                          if (lastRm) {
                            handleRemoveEmptyRoom(lastRm.roomNum, lastRm.roomName, lastRm.booksCount);
                          }
                        }}
                        className="text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 font-semibold cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Xóa Phòng {pad2(spatialRooms.length)}
                      </Button>
                    )}
                  </>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenMiniMap({ location: "Phòng 01 - Kệ 01 - Ngăn 01" })}
                  className="text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 font-semibold cursor-pointer"
                >
                  <Compass className="h-4 w-4" /> Mở Sơ Đồ Chỉ Đường 2D
                </Button>
              </div>
            </div>
          </div>

          {/* Rooms Grid */}
          <div className="space-y-6">
            {spatialRooms.map((room) => {
              const lastShelfInRoom = room.shelves[room.shelves.length - 1];

              return (
                <Card key={room.roomName} className="border-border/80 shadow-xs overflow-hidden">
                  {/* Room Card Header */}
                  <CardHeader className="bg-muted/30 border-b pb-4 pt-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-base">
                          🏢
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="font-display text-lg">{room.roomName}</CardTitle>
                            <Badge variant="outline" className="text-xs font-mono bg-background">
                              {room.shelves.length} kệ • {room.booksCount} đầu sách ({room.copiesCount} bản sao)
                            </Badge>
                          </div>
                          <CardDescription className="text-xs mt-0.5">
                            {room.shelves.length} dãy kệ đang hoạt động • {room.availableCopiesCount} bản sao sẵn sàng cho mượn
                          </CardDescription>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                        {canManage && (
                          <>
                            {room.shelves.length > 6 && lastShelfInRoom && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveLastShelfFromRoom(room.roomNum, room.roomName, lastShelfInRoom)}
                                className="text-xs gap-1 h-8 text-muted-foreground hover:text-destructive cursor-pointer"
                                title={`Xóa kệ trống cuối cùng (${lastShelfInRoom.shelfName})`}
                              >
                                <Minus className="h-3.5 w-3.5" /> Bớt kệ
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => handleAddShelfToRoom(room.roomNum, room.roomName, room.shelves.length)}
                              className="text-xs gap-1.5 h-8 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 font-semibold cursor-pointer"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Thêm Kệ ({`Kệ ${pad2(room.shelves.length + 1)}`})
                            </Button>
                            {room.roomNum > 3 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleRemoveEmptyRoom(room.roomNum, room.roomName, room.booksCount)}
                                className="text-xs gap-1 h-8 border-destructive/40 text-destructive hover:bg-destructive/10 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Xóa {room.roomName}
                              </Button>
                            )}
                          </>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenMiniMap({ location: `${room.roomName} - Kệ 01 - Ngăn 01` })}
                          className="text-xs gap-1.5 h-8 border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
                        >
                          <Compass className="h-3.5 w-3.5" /> Xem Sơ Đồ Phòng
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedRoomFilter(room.roomName);
                            setSelectedShelfFilter("all");
                            setSelectedCategoryFilter("all");
                            setActiveViewTab("catalog");
                          }}
                          className="text-xs gap-1 h-8 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Xem tất cả sách <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Categories Pills in this Room */}
                    <div className="pt-3 border-t mt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground/80 mr-1 flex items-center gap-1">
                          📌 Các thể loại có trong {room.roomName}:
                        </span>
                        {room.categories.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">Chưa có sách xếp vào phòng này</span>
                        ) : (
                          room.categories.map((cat) => (
                            <Badge
                              key={cat.name}
                              variant="secondary"
                              onClick={() => handleFilterByRoomCategory(room.roomName, cat.name)}
                              className="cursor-pointer hover:bg-primary/20 hover:text-primary transition-all text-xs py-1 px-2.5 gap-1.5 font-medium border border-border/70"
                              title={`Nhấn để xem các sách thuộc thể loại "${cat.name}" trong ${room.roomName}`}
                            >
                              <span>🏷️ {cat.name}</span>
                              <span className="text-[10px] px-1 py-0.2 rounded-full bg-background/80 font-bold">
                                {cat.count} cuốn
                              </span>
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {/* Shelves Breakdown in this Room */}
                  <CardContent className="p-4 sm:p-5 space-y-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                      <span>DANH SÁCH CÁC KỆ SÁCH & NGĂN TRONG {room.roomName.toUpperCase()}</span>
                      <span>{room.shelves.length} KỆ HOẠT ĐỘNG</span>
                    </div>

                    {room.shelves.length === 0 ? (
                      <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-xl">
                        Phòng này hiện chưa có kệ sách nào.
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {room.shelves.map((shelf) => {
                          const shelfKey = `${room.roomName}_${shelf.shelfName}`;
                          const isExpanded = !!expandedShelves[shelfKey];
                          const topRackObj = shelf.racks[shelf.racks.length - 1];

                          return (
                            <div 
                              key={shelf.shelfName} 
                              className="rounded-xl border bg-card/60 hover:bg-card transition-all p-3.5 space-y-2.5 shadow-2xs flex flex-col justify-between"
                            >
                              <div className="space-y-2">
                                {/* Shelf title & actions */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                      <Layers className="h-4 w-4" />
                                    </div>
                                    <div>
                                      <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                        <span>{shelf.shelfName}</span>
                                        <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                                          {shelf.maxRack} ngăn
                                        </Badge>
                                      </h4>
                                      <p className="text-[11px] text-muted-foreground">
                                        {shelf.books.length} đầu sách ({shelf.totalCopies} bản sao)
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {canManage && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleOpenShelfAudit(`${room.roomName} - ${shelf.shelfName} - Ngăn 01`)
                                        }
                                        className="h-7 text-[11px] px-2 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 gap-1 shrink-0 cursor-pointer font-semibold"
                                        title={`Kiểm kê nhanh ${shelf.shelfName} (${room.roomName}) bằng quét QR hàng loạt`}
                                      >
                                        <Scan className="h-3 w-3 text-emerald-600" /> Kiểm kê QR
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleOpenMiniMap({ 
                                        location: `${room.roomName} - ${shelf.shelfName} - Ngăn 01`,
                                        title: `Kệ: ${shelf.shelfName} (${shelf.maxRack} ngăn)`,
                                        author: `${room.roomName} • Thư viện Athenaeum`
                                      })}
                                      className="h-7 text-[11px] px-2 text-primary hover:bg-primary/10 gap-1 shrink-0 cursor-pointer"
                                      title="Xem vị trí kệ này trên Mini Map"
                                    >
                                      <Compass className="h-3 w-3" /> Map
                                    </Button>
                                  </div>
                                </div>

                                {/* Visual Racks (Ngăn) List & Librarian + Thêm Ngăn Button */}
                                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 space-y-2">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] font-semibold text-foreground/80">
                                      Các ngăn trên {shelf.shelfName}:
                                    </span>
                                    {canManage && (
                                      <div className="flex items-center gap-1">
                                        {shelf.maxRack > 5 && topRackObj && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleRemoveTopRackFromShelf(
                                                room.roomNum,
                                                shelf.shelfNum,
                                                shelf.shelfName,
                                                shelf.maxRack,
                                                topRackObj.bookCount
                                              )
                                            }
                                            className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                            title={`Xóa ngăn trống trên cùng (Ngăn ${pad2(shelf.maxRack)})`}
                                          >
                                            - Bớt
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleAddRackToShelf(
                                              room.roomNum,
                                              room.roomName,
                                              shelf.shelfNum,
                                              shelf.shelfName,
                                              shelf.maxRack
                                            )
                                          }
                                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer flex items-center gap-0.5"
                                          title="Thêm tầng ngăn mới lên kệ này"
                                        >
                                          <Plus className="h-2.5 w-2.5" /> Thêm Ngăn ({`Ngăn ${pad2(shelf.maxRack + 1)}`})
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap gap-1">
                                    {shelf.racks.map((rk) => (
                                      <button
                                        key={rk.rackNum}
                                        type="button"
                                        onClick={() =>
                                          handleOpenMiniMap({
                                            location: `${room.roomName} - ${shelf.shelfName} - ${rk.rackName}`,
                                            title: `${room.roomName} • ${shelf.shelfName} • ${rk.rackName}`,
                                            author: `${rk.bookCount} đầu sách đang xếp tại ngăn này`,
                                          })
                                        }
                                        className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-all cursor-pointer ${
                                          rk.bookCount > 0
                                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold hover:bg-emerald-500/20"
                                            : "bg-background text-muted-foreground border-border/70 hover:border-primary/40 hover:text-foreground"
                                        }`}
                                        title={`Bấm để xem ${rk.rackName} trên sơ đồ Mini Map`}
                                      >
                                        {rk.rackName} ({rk.bookCount})
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Categories on this shelf */}
                                {shelf.categories.length > 0 && (
                                  <div className="flex flex-wrap gap-1 pt-0.5">
                                    {shelf.categories.map((cName) => (
                                      <Badge key={cName} variant="outline" className="text-[10px] py-0 px-1.5 bg-muted/50">
                                        {cName}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Books preview & Expandable list */}
                              <div className="pt-2 border-t text-xs space-y-2">
                                <div className="flex items-center justify-between">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleShelfExpanded(shelfKey)}
                                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1 -ml-2 cursor-pointer"
                                  >
                                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    <span>{isExpanded ? "Thu gọn danh sách sách" : `Xem ${shelf.books.length} sách trên kệ`}</span>
                                  </Button>

                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleFilterByRoomShelf(room.roomName, shelf.shelfName)}
                                    className="h-7 text-[11px] px-2 border-border/80 hover:bg-muted cursor-pointer"
                                  >
                                    Lọc xem ở lưới
                                  </Button>
                                </div>

                                {/* Expanded list of books on this shelf */}
                                {isExpanded && (
                                  <div className="space-y-1.5 pt-1 max-h-48 overflow-y-auto pr-1">
                                    {shelf.books.length === 0 ? (
                                      <p className="text-[11px] text-muted-foreground italic py-2 text-center">
                                        Kệ này chưa có sách. Thủ thư có thể thêm sách mới hoặc điều chuyển sách vào đây.
                                      </p>
                                    ) : (
                                      shelf.books.map((b) => (
                                        <div 
                                          key={b.id} 
                                          className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 text-xs flex items-center justify-between gap-2 border border-border/40 transition-colors"
                                        >
                                          <div className="truncate flex-1">
                                            <p 
                                              className="font-medium text-foreground truncate cursor-pointer hover:text-primary"
                                              onClick={() => handleOpenBookDetail(b)}
                                              title={b.title}
                                            >
                                              {b.title}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground truncate">
                                              {parseLocation(b.location).rack} • Còn {b.available_copies}/{b.total_copies} cuốn
                                            </p>
                                          </div>

                                          <div className="flex items-center gap-1 shrink-0">
                                            {canManage && (
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleOpenRelocate(b)}
                                                className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                                                title="Đổi vị trí sách này"
                                              >
                                                <ArrowRightLeft className="h-3 w-3" />
                                              </Button>
                                            )}
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleOpenMiniMap(b)}
                                              className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                                              title="Định vị sách"
                                            >
                                              <Compass className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: TRA CỨU THỂ LOẠI ⇄ VỊ TRÍ PHÒNG & KỆ (CATEGORY MATRIX) */}
      {activeViewTab === "categories" && (
        <div className="space-y-6">
          {/* Top Info Banner */}
          <div className="bg-gradient-to-r from-primary/5 via-accent/10 to-primary/5 border border-primary/20 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-display font-bold text-base sm:text-lg flex items-center gap-2 text-foreground">
                  <FolderTree className="h-5 w-5 text-primary" /> Bảng Tra Cứu Thể Loại Sách ⇄ Phòng & Kệ
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">
                  Giúp Thủ thư và Độc giả tra cứu nhanh xem mỗi <strong>thể loại sách</strong> đang được quy hoạch 
                  tại <strong>phòng nào</strong>, gồm <strong>những kệ nào</strong> để sắp xếp kho sách khoa học, 
                  hướng dẫn độc giả tìm sách nhanh chóng mà không cần tìm kiếm thủ công.
                </p>
              </div>

              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={categorySearchQ}
                  onChange={(e) => setCategorySearchQ(e.target.value)}
                  placeholder="Lọc tên thể loại..."
                  className="pl-9 text-xs h-9 bg-background"
                />
              </div>
            </div>
          </div>

          {/* Matrix Table */}
          <Card className="border shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="font-bold text-xs">Thể loại sách</TableHead>
                  <TableHead className="font-bold text-xs">Phòng lưu trữ chính</TableHead>
                  <TableHead className="font-bold text-xs">Các kệ chứa thể loại này</TableHead>
                  <TableHead className="font-bold text-xs">Quy mô lưu kho</TableHead>
                  <TableHead className="font-bold text-xs text-right">Thao tác tra cứu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryMatrix
                  .filter(c => !categorySearchQ || c.categoryName.toLowerCase().includes(categorySearchQ.toLowerCase()))
                  .map((cat) => (
                    <TableRow key={cat.categoryName} className="hover:bg-muted/40 transition-colors">
                      {/* Cột 1: Tên thể loại */}
                      <TableCell className="font-medium text-xs">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            🏷️
                          </div>
                          <div>
                            <p className="font-bold text-sm text-foreground">{cat.categoryName}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {cat.booksCount} đầu sách trong thư viện
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Cột 2: Phòng lưu trữ chính */}
                      <TableCell className="text-xs">
                        {cat.roomsList.length === 0 ? (
                          <span className="text-muted-foreground italic">Chưa xếp kho</span>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="outline" className="font-semibold text-xs bg-primary/5 text-primary border-primary/20 gap-1">
                              🏢 {cat.primaryRoom}
                            </Badge>
                            {cat.roomsList.length > 1 && (
                              <p className="text-[10px] text-muted-foreground">
                                + {cat.roomsList.slice(1).map(r => r.roomName).join(", ")}
                              </p>
                            )}
                          </div>
                        )}
                      </TableCell>

                      {/* Cột 3: Các Kệ lưu trữ */}
                      <TableCell className="text-xs">
                        {cat.roomsList.length === 0 ? (
                          <span className="text-muted-foreground italic">-</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {cat.roomsList.map(r => (
                              r.shelves.map(s => (
                                <Badge 
                                  key={`${r.roomName}_${s}`} 
                                  variant="secondary" 
                                  className="text-[10px] py-0.5 px-2 bg-muted hover:bg-muted/80 cursor-pointer font-mono"
                                  onClick={() => handleFilterByRoomShelf(r.roomName, s)}
                                  title={`Xem các sách thuộc ${r.roomName} - ${s}`}
                                >
                                  {r.roomName.replace("Phòng ", "P.")} : {s}
                                </Badge>
                              ))
                            ))}
                          </div>
                        )}
                      </TableCell>

                      {/* Cột 4: Quy mô sách */}
                      <TableCell className="text-xs">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-foreground">
                            {cat.totalCopies} cuốn bản sao
                          </p>
                          <p className="text-[11px] text-emerald-600 font-medium">
                            Còn {cat.availableCopies} cuốn sẵn sàng
                          </p>
                        </div>
                      </TableCell>

                      {/* Cột 5: Nút hành động */}
                      <TableCell className="text-right text-xs">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleFilterByCategoryOnly(cat.categoryName)}
                            className="h-8 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                            title="Xem tất cả sách thuộc thể loại này ở lưới danh mục"
                          >
                            <Search className="h-3.5 w-3.5" /> Xem sách
                          </Button>

                          {cat.roomsList.length > 0 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const r = cat.roomsList[0];
                                const s = r.shelves[0] || "Kệ 01";
                                handleOpenMiniMap({
                                  location: `${r.roomName} - ${s} - Ngăn 01`,
                                  title: `Thể loại: ${cat.categoryName}`,
                                  author: `${r.roomName} • ${s}`,
                                });
                              }}
                              className="h-8 text-xs gap-1 border-border hover:bg-muted"
                              title="Mở Mini Map định vị kệ chính của thể loại này"
                            >
                              <Compass className="h-3.5 w-3.5" /> Bản đồ
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* QUICK RELOCATION MODAL (ĐIỀU CHUYỂN VỊ TRÍ SÁCH DÀNH CHO THỦ THƯ) */}
      <Dialog open={relocateModalOpen} onOpenChange={setRelocateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" /> Điều Chuyển Vị Trí Sách Trong Kho
            </DialogTitle>
            <DialogDescription className="text-xs">
              Thay đổi Phòng, Kệ hoặc Ngăn lưu kho để gom sách theo đúng phân loại của thư viện.
            </DialogDescription>
          </DialogHeader>

          {relocatingBook && (
            <div className="space-y-4 pt-1">
              {/* Current Book Info Card */}
              <div className="p-3 rounded-xl bg-muted/40 border border-border/70 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground truncate">{relocatingBook.title}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {relocatingBook.category_name || "Chưa phân loại"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-muted-foreground pt-1 border-t">
                  <span>Vị trí hiện tại:</span>
                  <span className="font-mono font-bold text-foreground">
                    📍 {relocatingBook.location || "Chưa thiết lập"}
                  </span>
                </div>
              </div>

              {/* Smart Category Placement Suggestion */}
              {suggestedPlacement && (
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs space-y-2">
                  <div className="flex items-start gap-2 text-foreground">
                    <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-primary">Gợi ý gom sách theo thể loại:</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Thể loại <strong>{suggestedPlacement.category}</strong> hiện tập trung nhiều nhất tại 
                        <strong> {suggestedPlacement.room} - {suggestedPlacement.shelf}</strong> ({suggestedPlacement.count} cuốn).
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRelocateRoom(suggestedPlacement.room);
                      setRelocateShelf(suggestedPlacement.shelf);
                    }}
                    className="w-full text-xs h-7 gap-1 border-primary/30 text-primary hover:bg-primary/10 font-semibold"
                  >
                    <Check className="h-3.5 w-3.5" /> Áp dụng vị trí gợi ý: {suggestedPlacement.room} - {suggestedPlacement.shelf}
                  </Button>
                </div>
              )}

              {/* Position Pickers */}
              {!useCustomLocation ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {/* Room Picker */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">Phòng</label>
                        <button
                          type="button"
                          onClick={() => {
                            const maxNum = dynamicRoomOptions.reduce((m, r) => {
                              const n = parseInt(r.match(/\d+/)?.[0] || "0", 10);
                              return Math.max(m, n);
                            }, 3);
                            const nextNum = maxNum + 1;
                            const nextLabel = `Phòng ${nextNum < 10 ? `0${nextNum}` : nextNum}`;
                            setRelocateRoom(nextLabel);
                            toast.info(`Đã thêm & chọn ${nextLabel}`);
                          }}
                          className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                          title="Thêm phòng mới tiếp theo"
                        >
                          + Thêm phòng
                        </button>
                      </div>
                      <Select value={relocateRoom} onValueChange={setRelocateRoom}>
                        <SelectTrigger className="text-xs mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dynamicRoomOptions.map((rm) => (
                            <SelectItem key={rm} value={rm}>{rm}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Shelf Picker */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">Kệ sách</label>
                        <button
                          type="button"
                          onClick={() => {
                            const maxNum = dynamicShelfOptions.reduce((m, s) => {
                              const n = parseInt(s.match(/\d+/)?.[0] || "0", 10);
                              return Math.max(m, n);
                            }, 6);
                            const nextNum = maxNum + 1;
                            const nextLabel = `Kệ ${nextNum < 10 ? `0${nextNum}` : nextNum}`;
                            setRelocateShelf(nextLabel);
                            toast.info(`Đã thêm & chọn ${nextLabel} (Sơ đồ sẽ tự động mở rộng)`);
                          }}
                          className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                          title="Thêm kệ mới tiếp theo"
                        >
                          + Thêm kệ
                        </button>
                      </div>
                      <Select value={relocateShelf} onValueChange={setRelocateShelf}>
                        <SelectTrigger className="text-xs mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dynamicShelfOptions.map((sh) => (
                            <SelectItem key={sh} value={sh}>{sh}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Rack Picker */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">Ngăn (Tầng)</label>
                        <button
                          type="button"
                          onClick={() => {
                            const maxNum = dynamicRackOptions.reduce((m, rk) => {
                              const n = parseInt(rk.match(/\d+/)?.[0] || "0", 10);
                              return Math.max(m, n);
                            }, 5);
                            const nextNum = maxNum + 1;
                            const nextLabel = `Ngăn ${nextNum < 10 ? `0${nextNum}` : nextNum}`;
                            setRelocateRack(nextLabel);
                            toast.info(`Đã thêm & chọn ${nextLabel} (Sơ đồ kệ sẽ tự động thêm tầng)`);
                          }}
                          className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                          title="Thêm ngăn mới tiếp theo"
                        >
                          + Thêm ngăn
                        </button>
                      </div>
                      <Select value={relocateRack} onValueChange={setRelocateRack}>
                        <SelectTrigger className="text-xs mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dynamicRackOptions.map((rk) => (
                            <SelectItem key={rk} value={rk}>{rk}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Result Preview */}
                  <div className="p-2.5 rounded-lg bg-muted border text-center">
                    <p className="text-[11px] text-muted-foreground">Ký hiệu vị trí mới sẽ lưu (Sơ đồ dẫn đường tự động cập nhật):</p>
                    <p className="font-mono font-bold text-sm text-primary mt-0.5">
                      📍 {relocateRoom} - {relocateShelf} - {relocateRack}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Nhập chuỗi vị trí tùy chỉnh</label>
                  <Input
                    value={customLocation}
                    onChange={(e) => setCustomLocation(e.target.value)}
                    placeholder="VD: Phòng 01 - Kệ 03 - Ngăn 02"
                    className="text-xs mt-1"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setUseCustomLocation(!useCustomLocation)}
                  className="text-[11px] text-primary hover:underline"
                >
                  {useCustomLocation ? "← Quay lại bộ chọn chuẩn (Phòng/Kệ/Ngăn)" : "Tùy chỉnh nhập tay chuỗi vị trí"}
                </button>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRelocateModalOpen(false)}
              className="text-xs"
            >
              Hủy
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmRelocate}
              disabled={isSubmittingRelocate}
              className="text-xs gap-1.5 font-semibold"
            >
              {isSubmittingRelocate ? "Đang lưu..." : "Xác nhận điều chuyển"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG FOR QR CODES (IN DÁN BẢN SAO) */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" /> Mã QR Bản Sao Đầu Sách
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedBookForQr?.title} ({selectedBookForQr?.category_name || "Sách thư viện"})
            </DialogDescription>
          </DialogHeader>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3.5 text-xs text-muted-foreground space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">💡 Trạng thái các bản sao trong kho:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="bg-background text-xs font-semibold">
                  Tổng: {bookCopies.length} bản sao
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-300 text-xs">
                  Sẵn sàng tự do: {Math.max(0, bookCopies.filter(c => c.status === 'available').length - activeBookHolds.length)}
                </Badge>
                {activeBookHolds.length > 0 && (
                  <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-400/50 text-xs font-semibold gap-1">
                    <Clock className="h-3 w-3 text-amber-600" /> Đang giữ chỗ (24h/48h): {activeBookHolds.length}
                  </Badge>
                )}
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-300 text-xs">
                  Đang mượn: {bookCopies.filter(c => c.status === 'borrowed').length}
                </Badge>
              </div>
            </div>

            {/* Hold Banner if readers registered holds online or reservation holds */}
            {activeBookHolds.length > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-800 dark:text-amber-300">
                  <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>Đang có {activeBookHolds.length} suất giữ chỗ ưu tiên (Phiếu mượn nháp 24h / Đặt trước có sách 48h):</span>
                </div>
                <div className="mt-2 space-y-1.5 pl-2 text-[11px]">
                  {activeBookHolds.map((h: any, idx: number) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 bg-background/60 p-1.5 rounded-md border border-amber-300/40">
                      <span className="font-semibold text-foreground">• {h.reader_name || h.full_name || h.user_name || "Độc giả"}</span>
                      <span className="text-muted-foreground font-mono">({h.card_number || "---"})</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/40">
                        {h.time_left_hours != null ? `Còn ${h.time_left_hours}h` : h.hold_type === "reservation" ? "Giữ 48h" : "Giữ 24h"}
                      </Badge>
                      {h.copy_qr_code ? (
                        <Badge className="bg-indigo-600 text-white text-[10px] py-0 px-1.5 h-4 font-mono">
                          🔒 Khóa riêng bản sao: {h.copy_qr_code}
                        </Badge>
                      ) : null}
                      {h.draft_code && (
                        <span className="text-muted-foreground font-mono text-[10px]">
                          [{h.hold_type === "reservation" ? `Giữ ưu tiên Đặt trước: ${h.draft_code}` : `Phiếu mượn nháp: ${h.draft_code}`}]
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">• Mỗi bản sao sách trong kho có 1 mã QR độc lập dán trên bìa/gáy sách để phục vụ kiểm kê và mượn trả.</p>
          </div>

          {loadingQr ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : bookCopies.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Chưa có bản sao nào được tạo cho cuốn sách này.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 pt-2">
              {bookCopies.map((copy, index) => {
                const isBorrowed = copy.status === 'borrowed';
                const isAvailable = copy.status === 'available';
                const hasShelfDraft = Boolean(copy.active_draft_code && isAvailable);

                return (
                  <div 
                    key={copy.id} 
                    className={`border rounded-xl p-3.5 flex flex-col items-center text-center bg-card shadow-2xs space-y-2.5 transition-all ${
                      isBorrowed 
                        ? 'border-amber-400/40 bg-amber-500/[0.02]' 
                        : hasShelfDraft
                        ? 'border-blue-400/50 bg-blue-500/[0.03]'
                        : 'border-emerald-500/30 hover:border-emerald-500/60'
                    }`}
                  >
                    <div className="bg-white p-2 rounded-lg border shadow-xs">
                      <QRCodeCanvas id={`qr-canvas-${copy.qr_code}`} value={copy.qr_code} size={110} />
                    </div>

                    <div>
                      <span className="font-semibold text-xs block text-foreground">Bản sao #{index + 1}</span>
                      <span className="font-mono text-[10px] text-muted-foreground block truncate max-w-[160px]">{copy.qr_code}</span>
                    </div>

                    {/* Status Badge */}
                    <div>
                      {isBorrowed ? (
                        <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] uppercase font-bold tracking-wider">
                          ĐANG CHO MƯỢN
                        </Badge>
                      ) : hasShelfDraft ? (
                        <Badge className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] uppercase font-bold tracking-wider">
                          ĐÃ ĐỐI SOÁT TẠI KỆ
                        </Badge>
                      ) : isAvailable ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] uppercase font-bold tracking-wider">
                          SẴN SÀNG TRÊN KỆ
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] uppercase font-bold">
                          {copy.status}
                        </Badge>
                      )}
                    </div>

                    {/* Borrower / Reader Info Box */}
                    {isBorrowed && (
                      <div className="w-full text-left bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-lg p-2 text-[11px] space-y-1">
                        <div className="flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-200 truncate">
                          <User className="h-3 w-3 text-amber-600 shrink-0" />
                          <span className="truncate">{copy.borrower_name || "Độc giả"}</span>
                        </div>
                        <div className="text-muted-foreground font-mono text-[10px]">
                          Thẻ: {copy.borrower_card_number || "---"}
                        </div>
                        {copy.due_date && (
                          <div className="text-amber-700 dark:text-amber-400 text-[10px]">
                            Hạn trả: {new Date(copy.due_date).toLocaleDateString("vi-VN")}
                          </div>
                        )}
                      </div>
                    )}

                    {hasShelfDraft && (
                      <div className="w-full text-left bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-lg p-2 text-[11px] space-y-1">
                        <div className="flex items-center gap-1 font-semibold text-blue-900 dark:text-blue-200 truncate">
                          <User className="h-3 w-3 text-blue-600 shrink-0" />
                          <span className="truncate">{copy.draft_reader_name || "Độc giả"}</span>
                        </div>
                        <div className="text-muted-foreground text-[10px]">
                          Đã tự quét tại kệ, đang cầm sách ra quầy
                        </div>
                      </div>
                    )}

                    {isAvailable && !hasShelfDraft && (
                      <div className="w-full text-center py-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        ✓ Sẵn sàng cho độc giả lấy
                      </div>
                    )}

                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full text-xs h-7 gap-1 mt-auto" 
                      onClick={() => handleDownloadQr(copy.qr_code)}
                    >
                      <Download className="h-3 w-3" /> Tải mã
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG FOR EXCEL BATCH IMPORT */}
      <Dialog open={isExcelDialogOpen} onOpenChange={setIsExcelDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" /> Xác Nhận Nhập Sách Hàng Loạt Từ Excel
            </DialogTitle>
            <DialogDescription className="text-xs">
              File: <span className="font-semibold text-foreground">{excelFileName}</span> — Đã phân tích thành công{" "}
              <span className="font-bold text-emerald-600">{excelParsedData.length}</span> đầu sách.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto border rounded-xl my-2">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0">
                <TableRow>
                  <TableHead className="w-12 text-center text-xs">STT</TableHead>
                  <TableHead className="text-xs">Tên đầu sách</TableHead>
                  <TableHead className="text-xs">Tác giả</TableHead>
                  <TableHead className="text-xs">Thể loại</TableHead>
                  <TableHead className="text-xs">Vị trí lưu kho</TableHead>
                  <TableHead className="w-16 text-center text-xs">Số lượng</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {excelParsedData.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30">
                    <TableCell className="text-center font-mono text-xs">{idx + 1}</TableCell>
                    <TableCell className="font-medium text-xs max-w-[200px] truncate" title={row.title}>
                      {row.title}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate">{row.author || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {row.category || "Mặc định"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {row.location || "Tự động phân phòng"}
                    </TableCell>
                    <TableCell className="text-center font-semibold text-xs text-primary">{row.total_copies}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-300">
            <p className="font-semibold">⚡ Cơ chế tự động hóa Athenaeum:</p>
            <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[11px] text-muted-foreground">
              <li>Tự động nhận diện hoặc thêm mới Tác giả, Thể loại, Nhà xuất bản nếu chưa có trong CSDL.</li>
              <li>Nếu sách đã tồn tại (trùng ISBN hoặc Tên), hệ thống sẽ tăng thêm số lượng bản sao.</li>
              <li>Tự động gán vị trí Phòng - Kệ - Ngăn chuẩn và sinh mã QR riêng biệt cho từng cuốn sách.</li>
            </ul>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              className="text-xs gap-1.5 text-muted-foreground"
            >
              <FileDown className="h-3.5 w-3.5" /> Tải file mẫu lại
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExcelDialogOpen(false)}
                disabled={isSubmittingImport}
                className="text-xs"
              >
                Hủy bỏ
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmBatchImport}
                disabled={isSubmittingImport}
                className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                {isSubmittingImport ? (
                  <>
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                    Đang lưu vào CSDL...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Xác nhận nhập {excelParsedData.length} sách
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG BOOK DETAIL (XEM CHI TIẾT & ĐÁNH GIÁ & VỊ TRÍ) */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedBookForDetail && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-semibold">
                    {selectedBookForDetail.category_name || "Sách thư viện"}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    ID: #{selectedBookForDetail.id}
                  </span>
                </div>
                <DialogTitle className="font-display text-lg sm:text-xl font-bold mt-1 text-foreground">
                  {selectedBookForDetail.title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Tác giả: <strong className="text-foreground">{selectedBookForDetail.author_name || "Khuyết danh"}</strong> • 
                  Nhà xuất bản: <strong className="text-foreground">{selectedBookForDetail.publisher_name || "Chưa cập nhật"}</strong>
                </DialogDescription>
              </DialogHeader>

              {/* Main Book Detail Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                {/* Book Cover */}
                <div className="h-56 sm:h-full bg-gradient-to-br from-primary/10 via-accent/20 to-terracotta/10 rounded-xl overflow-hidden flex items-center justify-center border">
                  {selectedBookForDetail.cover_image ? (
                    <img
                      src={selectedBookForDetail.cover_image}
                      alt={selectedBookForDetail.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-6xl select-none">📚</div>
                  )}
                </div>

                {/* Book Metadata & Location */}
                <div className="sm:col-span-2 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-muted/40 p-2.5 rounded-lg border">
                      <span className="text-muted-foreground block text-[10px]">Mã ISBN:</span>
                      <span className="font-mono font-semibold text-foreground truncate block">
                        {selectedBookForDetail.isbn || "Chưa cập nhật"}
                      </span>
                    </div>
                    <div className="bg-muted/40 p-2.5 rounded-lg border">
                      <span className="text-muted-foreground block text-[10px]">Năm xuất bản:</span>
                      <span className="font-semibold text-foreground">
                        {selectedBookForDetail.published_year || "Không rõ"}
                      </span>
                    </div>
                    <div className="bg-muted/40 p-2.5 rounded-lg border">
                      <span className="text-muted-foreground block text-[10px]">Tổng số bản sao:</span>
                      <span className="font-bold text-foreground">
                        {selectedBookForDetail.total_copies} cuốn
                      </span>
                    </div>
                    <div className="bg-muted/40 p-2.5 rounded-lg border">
                      <span className="text-muted-foreground block text-[10px]">Bản sao sẵn có:</span>
                      <span className={selectedBookForDetail.available_copies > 0 ? "font-bold text-emerald-600" : "font-bold text-destructive"}>
                        {selectedBookForDetail.available_copies > 0 ? `Còn ${selectedBookForDetail.available_copies} cuốn` : `Hết sách (0/${selectedBookForDetail.total_copies} cuốn)`}
                      </span>
                    </div>
                  </div>

                  {/* Smart Wait-Time Predictor in Book Detail Modal when out of stock */}
                  {selectedBookForDetail.available_copies <= 0 && selectedBookForDetail.wait_prediction && (
                    <div className="rounded-xl border-2 border-amber-500/45 bg-amber-500/10 p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-amber-600" />
                          Dự Báo Ngày Có Sách Khi Đặt Trước:
                        </span>
                        <Badge className="bg-amber-600 text-white text-[10px]">
                          Hàng chờ #{selectedBookForDetail.wait_prediction.queue_position}
                        </Badge>
                      </div>
                      <p className="text-foreground font-medium leading-relaxed">
                        Dự kiến có sách sau{" "}
                        <strong className="text-amber-700 dark:text-amber-300">
                          ~{selectedBookForDetail.wait_prediction.estimated_wait_days} ngày nữa
                        </strong>{" "}
                        (Bản sao sớm nhất sẽ hoàn trả vào{" "}
                        <strong>{selectedBookForDetail.wait_prediction.earliest_due_date_vn}</strong> • Bạn đứng thứ{" "}
                        <strong>#{selectedBookForDetail.wait_prediction.queue_position}</strong> trong hàng chờ).
                      </p>
                    </div>
                  )}

                  {/* Location Information & Mini Map */}
                  <div className="bg-muted/40 border border-border/70 rounded-xl p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        📍 Vị trí lưu kho trong thư viện:
                      </span>
                      <Badge variant="outline" className="font-mono text-xs font-bold bg-background text-foreground border-border">
                        {selectedBookForDetail.location || "Phòng 01 - Kệ 01 - Ngăn 01"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Độc giả đến đúng phòng, kệ và ngăn ghi trên để lấy sách mang ra quầy làm thủ tục mượn.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenMiniMap(selectedBookForDetail)}
                        className="flex-1 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10 h-8 font-semibold"
                      >
                        <Compass className="h-4 w-4 text-primary" />
                        <span>Mở Sơ Đồ Mini Map Chỉ Đường Đến Kệ</span>
                      </Button>

                      {canManage && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDetailDialogOpen(false);
                            handleOpenRelocate(selectedBookForDetail);
                          }}
                          className="text-xs h-8 gap-1 border-border hover:bg-muted font-medium"
                          title="Đổi phòng, kệ lưu kho"
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" /> Đổi vị trí
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Full Description Box */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <FileText className="h-4 w-4 text-primary" />
                      <span>Mô tả & Tóm tắt nội dung sách:</span>
                    </div>
                    <div className="bg-background border rounded-xl p-3.5 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-44 overflow-y-auto">
                      {selectedBookForDetail.description ? (
                        <p className="text-foreground/90 font-normal">
                          {selectedBookForDetail.description}
                        </p>
                      ) : (
                        <p className="italic text-muted-foreground">
                          Đầu sách này hiện chưa có đoạn văn tóm tắt chi tiết. Bạn có thể liên hệ thủ thư để biết thêm thông tin.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Book Reviews & Ratings Section */}
              <div className="pt-2 border-t">
                <BookReviews 
                  bookId={selectedBookForDetail.id} 
                  bookTitle={selectedBookForDetail.title}
                  onRatingUpdated={(newAvg, newCount) => {
                    setSelectedBookForDetail(prev => prev ? { ...prev, avg_rating: newAvg, review_count: newCount } : null);
                    setBooksList(prev => prev.map(b => b.id === selectedBookForDetail.id ? { ...b, avg_rating: newAvg, review_count: newCount } : b));
                  }}
                />
              </div>

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-between pt-3 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailDialogOpen(false)}
                  className="text-xs"
                >
                  Đóng
                </Button>

                <div className="flex gap-2">
                  {user?.role === "reader" ? (
                    isBookInActiveDraft(selectedBookForDetail.id) ? (
                      <Button
                        size="sm"
                        className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                        onClick={() => {
                          setDetailDialogOpen(false);
                          setIsDraftQrModalOpen(true);
                        }}
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        Đã giữ chỗ 24h • Xem mã QR
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className={`text-xs gap-1.5 font-semibold ${
                          selectedBookForDetail.available_copies > 0 
                            ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                            : "bg-amber-600 hover:bg-amber-700 text-white"
                        }`}
                        onClick={() => {
                          setDetailDialogOpen(false);
                          handleRegisterBorrow(selectedBookForDetail);
                        }}
                      >
                        {selectedBookForDetail.available_copies > 0 ? (
                          <>
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            Đăng ký mượn online (Giữ chỗ 24h)
                          </>
                        ) : (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            Hết sách • Đặt trước
                          </>
                        )}
                      </Button>
                    )
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs gap-1.5"
                      onClick={() => {
                        setDetailDialogOpen(false);
                        handleOpenQrDialog(selectedBookForDetail);
                      }}
                    >
                      <QrCode className="h-3.5 w-3.5" /> Quản lý mã QR bản sao
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Transaction QR Modal for Online Borrow Registration (Phiếu mượn nháp - Giữ chỗ 24h) */}
      <Dialog open={isDraftQrModalOpen} onOpenChange={setIsDraftQrModalOpen}>
        <DialogContent className="sm:max-w-[620px] w-[95vw] max-h-[90vh] overflow-y-auto p-0 gap-0 rounded-2xl border border-indigo-500/30 shadow-2xl">
          {myActiveDraft ? (
            <div>
              {/* Header (pr-10 avoids colliding with the Dialog close X button) */}
              <div className="px-5 py-4 pr-10 border-b bg-gradient-to-r from-indigo-500/12 via-emerald-500/8 to-primary/5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-sm shrink-0 mt-0.5">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5">
                        🔒 PHIẾU MƯỢN NHÁP (CHỜ ĐỐI SOÁT)
                      </Badge>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-500/40 text-[11px] py-0.5 font-semibold">
                        <Clock className="h-3 w-3 mr-1 text-emerald-600" />
                        Giữ riêng 24h: Còn {myActiveDraft.time_left_hours != null ? `${myActiveDraft.time_left_hours} giờ` : "24 giờ"}
                      </Badge>
                    </div>
                    <DialogTitle className="text-base sm:text-lg font-extrabold text-foreground leading-snug">
                      Phiếu Mượn Nháp & Khóa Riêng Bản Sao 24h
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Hệ thống đã tự động khóa riêng 1 bản sao cụ thể trong 24 giờ cho bạn. Khi Thủ thư quét xác nhận tại quầy, phiếu này sẽ chuyển thành <strong>Phiếu mượn chính thức</strong> (hạn mượn 14 ngày).
                    </DialogDescription>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* QR Code and Workflow Steps Grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                  {/* Left: QR Display */}
                  <div className="md:col-span-5 flex flex-col items-center justify-center p-3.5 bg-indigo-500/[0.04] rounded-2xl border border-indigo-500/30 text-center">
                    <div className="bg-white p-2.5 rounded-xl shadow-2xs border border-slate-200 inline-block">
                      <QRCodeCanvas
                        id="canvas-my-draft-qr"
                        value={myActiveDraft.draft_code}
                        size={148}
                        level="H"
                        includeMargin={true}
                      />
                    </div>
                    <div className="mt-2.5 flex items-center gap-1">
                      <code className="text-xs font-mono font-bold px-2.5 py-0.5 bg-background rounded-md border border-border text-foreground">
                        {myActiveDraft.draft_code}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Sao chép mã Phiếu mượn nháp"
                        onClick={() => handleCopyDraftCode(myActiveDraft.draft_code)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className="mt-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-indigo-600 shrink-0" />
                      Đã khóa bản sao riêng 24h
                    </span>
                  </div>

                  {/* Right: Compact 3-Step Workflow & Reader Summary */}
                  <div className="md:col-span-7 flex flex-col justify-between gap-2.5">
                    <div className="bg-muted/25 border border-border/70 rounded-2xl p-3 space-y-2 flex-1">
                      <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                        Quy trình 3 bước Mượn sách & Đối soát:
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-start gap-2 p-2 rounded-xl bg-indigo-500/8 border border-indigo-500/20">
                          <span className="h-4.5 w-4.5 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                          <div className="leading-snug">
                            <p className="font-semibold text-indigo-950 dark:text-indigo-200 text-[11px]">Tạo Phiếu mượn nháp & Khóa giữ chỗ 24h</p>
                            <p className="text-[11px] text-muted-foreground">Hệ thống đã khóa giữ riêng {myActiveDraft.items?.length || 1} suất bản sao trên kệ trong 24h.</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 p-2 rounded-xl bg-amber-500/8 border border-amber-500/20">
                          <span className="h-4.5 w-4.5 rounded-full bg-amber-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                          <div className="leading-snug">
                            <p className="font-semibold text-amber-950 dark:text-amber-200 text-[11px]">Tự đến kệ lấy sách & Quét Tem Sách Tại Kệ</p>
                            <p className="text-[11px] text-muted-foreground">Đến kệ lấy sách và bấm <strong>"Quét Tem Sách Tại Kệ"</strong> để định danh mã bản sao.</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 p-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                          <span className="h-4.5 w-4.5 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                          <div className="leading-snug">
                            <p className="font-semibold text-emerald-950 dark:text-emerald-200 text-[11px]">Tới quầy đưa mã Phiếu nháp / Thẻ độc giả</p>
                            <p className="text-[11px] text-muted-foreground">Thủ thư quét đối soát cho mượn → Chuyển thành <strong>Phiếu mượn chính thức</strong>.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-xl border border-border/60 flex items-center justify-between">
                      <span><strong>Độc giả:</strong> {user?.name || "Bạn"} ({user?.card_number || "Thành viên"})</span>
                      <Badge variant="secondary" className="text-[11px] font-bold">
                        Đã quét tại kệ: {myActiveDraft.verified_count || 0}/{myActiveDraft.items?.length || 1} cuốn
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* List of books in this transaction (Sorted by Multi-Book Pick Path) */}
                {(() => {
                  const modalPickPath = optimizeMultiBookPickPath(myActiveDraft.items || []);
                  const orderedModalItems = modalPickPath.orderedItems;
                  return (
                    <div className="space-y-2.5">
                      {/* Route Optimization Banner */}
                      {orderedModalItems.length > 0 && (
                        <div className="rounded-xl border border-emerald-500/35 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-indigo-500/10 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                              <Compass className="h-3.5 w-3.5 text-emerald-600" />
                              Lộ Trình Đi Lấy Nhiều Sách Tối Ưu (Multi-Book Pick Path)
                            </span>
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700 bg-background">
                              Phòng gần sảnh → Kệ thấp đến cao → Ngăn dưới lên trên
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                            <span className="px-2 py-0.5 rounded-md bg-background border font-semibold shrink-0">
                              🏁 Sảnh chính
                            </span>
                            {orderedModalItems.map((item: any) => {
                              const loc = item._pickPath.parsedLocation;
                              const isVerified = Boolean(item.book_copy_id);
                              return (
                                <div key={`modal-stop-${item.item_id || item.book_id || item._pickPath.stepOrder}`} className="flex items-center gap-1 shrink-0">
                                  <ArrowRight className="h-3 w-3 text-emerald-600 shrink-0" />
                                  <button
                                    type="button"
                                    onClick={() => handleOpenMiniMap({ location: item.location, title: item.book_title, cover: item.cover_image })}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold cursor-pointer ${
                                      isVerified
                                        ? "bg-indigo-600 text-white border-indigo-600"
                                        : "bg-background hover:bg-emerald-50 border-emerald-500/40 text-foreground"
                                    }`}
                                    title="Bấm xem sơ đồ 2D kệ sách"
                                  >
                                    <span>Chặng {item._pickPath.stepOrder}:</span>
                                    <span>{loc.roomLabel} • {loc.shelfLabel} • {loc.rackLabel}</span>
                                  </button>
                                </div>
                              );
                            })}
                            <ArrowRight className="h-3 w-3 text-indigo-600 shrink-0" />
                            <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 font-semibold text-indigo-700 shrink-0">
                              💁 Quầy Thủ thư
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold uppercase tracking-wider text-muted-foreground">
                          Thứ tự đi lấy sách tối ưu ({orderedModalItems.length || 1} cuốn)
                        </span>
                        <span className="text-[11px] text-muted-foreground">Đi theo Chặng #1 → #{orderedModalItems.length}</span>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {orderedModalItems.map((item: any, idx: number) => {
                          const isVerified = Boolean(item.book_copy_id);
                          const stepOrder = item._pickPath?.stepOrder || idx + 1;
                          return (
                            <div
                              key={item.item_id || item.book_id || idx}
                              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl border transition-colors ${
                                isVerified ? "border-indigo-500/30 bg-indigo-500/[0.03]" : "border-amber-500/30 bg-amber-500/[0.03]"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className={`px-2 h-6 rounded-md font-bold text-[10px] flex items-center justify-center shrink-0 ${
                                  isVerified ? "bg-indigo-600 text-white" : "bg-emerald-600 text-white"
                                }`}>
                                  {isVerified ? `✓ Chặng ${stepOrder}` : `Chặng ${stepOrder}`}
                                </span>
                                {item.cover_image ? (
                                  <img src={item.cover_image} alt="" className="h-10 w-7 object-cover rounded shadow-2xs shrink-0" />
                                ) : (
                                  <div className="h-10 w-7 bg-muted rounded flex items-center justify-center shrink-0">
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-xs text-foreground truncate" title={item.book_title}>
                                    {item.book_title}
                                  </p>
                                  {item._pickPath?.transitionHint && (
                                    <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 truncate mt-0.5">
                                      {item._pickPath.transitionHint}
                                    </p>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    {isVerified ? (
                                      <span className="inline-flex items-center gap-1 bg-indigo-600 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded-md whitespace-nowrap">
                                        ✓ Đã quét tại kệ: {item.copy_qr_code || `Bản sao #${item.book_copy_id}`}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center border border-amber-400 text-amber-800 bg-amber-50 text-[10px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap">
                                        🔒 Đã khóa giữ chỗ 1 bản sao (24h) • Chờ quét tại kệ
                                      </span>
                                    )}
                                    <span className="text-[11px] text-muted-foreground font-mono truncate">
                                      ISBN: {item.isbn || "N/A"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-1.5 shrink-0">
                                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[11px] py-1 font-medium whitespace-nowrap">
                                  <MapPin className="h-3 w-3 mr-1 text-primary shrink-0" />
                                  {item.location || "Phòng 01 - Kệ 01 - Ngăn 01"}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-primary hover:bg-primary/10 cursor-pointer"
                                  title="Xem sơ đồ 2D vị trí kệ sách"
                                  onClick={() => {
                                    handleOpenMiniMap({
                                      location: item.location,
                                      title: item.book_title,
                                      cover: item.cover_image
                                    });
                                  }}
                                >
                                  <Compass className="h-3.5 w-3.5" />
                                </Button>
                                {!isVerified ? (
                                  <Button
                                    size="sm"
                                    className="h-7 text-[11px] gap-1 px-2.5 font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                                    onClick={() => {
                                      setIsDraftQrModalOpen(false);
                                      navigate("/borrow?scan=shelf");
                                    }}
                                    title="Mở máy quét để quét tem sách tại kệ"
                                  >
                                    <Camera className="h-3 w-3" /> Quét Tem Sách Tại Kệ
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] gap-1 px-2 font-medium text-amber-700 hover:bg-amber-500/10 border-amber-300 cursor-pointer"
                                    onClick={() => handleUnverifyDraftItem(item.item_id || item.id, item.book_title)}
                                    title="Quét nhầm cuốn sách trên kệ? Bấm để gỡ mã và quét lại"
                                  >
                                    <RotateCcw className="h-3 w-3 text-amber-600" /> Quét lại
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 cursor-pointer shrink-0"
                                  onClick={() => handleRemoveDraftItem(item.item_id || item.id, item.book_title)}
                                  title="Xóa cuốn sách này khỏi phiếu mượn nháp"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="px-5 py-3.5 border-t bg-muted/25 flex flex-col sm:flex-row items-center justify-between gap-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 cursor-pointer"
                  onClick={() => handleCancelDraft(myActiveDraft.id)}
                >
                  <X className="h-3.5 w-3.5" />
                  Hủy phiếu mượn nháp
                </Button>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-initial text-xs gap-1.5 cursor-pointer"
                    onClick={() => handleDownloadDraftQr(myActiveDraft.draft_code)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Tải ảnh QR
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 sm:flex-initial text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                    onClick={() => {
                      setIsDraftQrModalOpen(false);
                      navigate("/borrow");
                    }}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Mở trang Phiếu mượn
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs cursor-pointer"
                    onClick={() => setIsDraftQrModalOpen(false)}
                  >
                    Đóng
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">Không tìm thấy thông tin phiếu mượn đang hoạt động.</p>
              <Button size="sm" className="mt-4 text-xs" onClick={() => setIsDraftQrModalOpen(false)}>
                Đóng
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mini Map Navigation Modal */}
      <LibraryMiniMapModal
        open={miniMapOpen}
        onOpenChange={setMiniMapOpen}
        location={miniMapTarget?.location}
        bookTitle={miniMapTarget?.title}
        authorName={miniMapTarget?.author}
        coverImage={miniMapTarget?.cover}
        books={booksList}
      />

      {/* Smart Shelf Inventory Audit Modal (Kiểm kê kho sách nhanh bằng quét QR hàng loạt) */}
      <SmartShelfAuditModal
        open={shelfAuditOpen}
        onOpenChange={setShelfAuditOpen}
        initialLocation={shelfAuditLocation}
        onOpenMiniMap={(target) => {
          handleOpenMiniMap(target);
        }}
      />

      {ConfirmDialogComponent}
    </div>
  );
}