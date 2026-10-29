import { useState, useMemo, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Compass,
  MapPin,
  Layers,
  Footprints,
  BookOpen,
  ArrowRight,
  Sparkles,
  Info,
  Copy,
  Check,
  Building,
  CheckCircle2,
  Share2,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  QrCode,
  Eye,
  Navigation,
  ShieldCheck,
  Inbox,
  Flame,
  Search,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";

export interface LibraryLocationParsed {
  raw: string;
  roomNum: number;
  shelfNum: number;
  rackNum: number;
  floorNum: number;
  roomLabel: string;
  shelfLabel: string;
  rackLabel: string;
}

export function parseLibraryLocation(locStr?: string): LibraryLocationParsed {
  const fallback: LibraryLocationParsed = {
    raw: locStr || "Phòng 01 - Kệ 01 - Ngăn 01",
    roomNum: 1,
    shelfNum: 1,
    rackNum: 1,
    floorNum: 1,
    roomLabel: "Phòng 01",
    shelfLabel: "Kệ 01",
    rackLabel: "Ngăn 01",
  };

  if (!locStr) return fallback;

  // Regex extract Room, Shelf, Rack
  const roomMatch = locStr.match(/(?:Phòng|Phong|Room|P)\s*0?(\d+)/i);
  const shelfMatch = locStr.match(/(?:Kệ|Ke|Shelf|K)\s*0?(\d+)/i);
  const rackMatch = locStr.match(/(?:Ngăn|Ngan|Rack|Tầng|Tang|Level|N)\s*0?(\d+)/i);

  const roomNum = roomMatch ? Math.max(1, parseInt(roomMatch[1], 10)) : 1;
  const shelfNum = shelfMatch ? Math.max(1, parseInt(shelfMatch[1], 10)) : 1;
  const rackNum = rackMatch ? Math.max(1, parseInt(rackMatch[1], 10)) : 1;

  // Floor heuristic: Room 1, 2, 3 -> Floor 1; Room 4, 5, 6 -> Floor 2
  const floorNum = roomNum > 3 ? 2 : 1;

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  return {
    raw: locStr,
    roomNum,
    shelfNum,
    rackNum,
    floorNum,
    roomLabel: `Phòng ${pad(roomNum)}`,
    shelfLabel: `Kệ ${pad(shelfNum)}`,
    rackLabel: `Ngăn ${pad(rackNum)}`,
  };
}

interface LibraryMiniMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location?: string;
  bookTitle?: string;
  authorName?: string;
  coverImage?: string;
}

export function LibraryMiniMapModal({
  open,
  onOpenChange,
  location,
  bookTitle,
  authorName,
  coverImage,
}: LibraryMiniMapModalProps) {
  const parsed = useMemo(() => parseLibraryLocation(location), [location]);
  const [activeFloor, setActiveFloor] = useState<number>(parsed.floorNum);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "shelf" | "steps" | "mobile">("map");

  // Interactive Map Controls
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [selectedShelf, setSelectedShelf] = useState<{ room: number; shelf: number } | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simStep, setSimStep] = useState<number>(0);
  const simTimerRef = useRef<any>(null);

  // Audio Voice Guidance (Web Speech API)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Sync floor when target location changes
  useEffect(() => {
    setActiveFloor(parsed.floorNum);
    setSelectedShelf({ room: parsed.roomNum, shelf: parsed.shelfNum });
  }, [parsed.floorNum, parsed.roomNum, parsed.shelfNum]);

  // Clean up timers & speech on unmount or close
  useEffect(() => {
    if (!open) {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      setIsSimulating(false);
      setSimStep(0);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [open]);

  // Shelf coordinates inside rooms (designed with clear walking aisles):
  // Canvas ViewBox: 0 0 940 600
  // Room 1: x: 40..400, y: 40..275. Shelves Row 1: y=115, Row 2: y=185
  // Room 2: x: 540..900, y: 40..275. Shelves Row 1: y=115, Row 2: y=185
  // Room 3: x: 40..400, y: 310..545. Shelves Row 1: y=385, Row 2: y=455
  // Shelf coordinates inside rooms (designed with clear walking aisles):
  // Canvas ViewBox: 0 0 940 600
  // Room 1: x: 40..400, y: 40..275. Shelves Row 1: y=120, Row 2: y=205. Width: 80, Height: 34
  // Room 2: x: 540..900, y: 40..275. Shelves Row 1: y=120, Row 2: y=205. Width: 80, Height: 34
  // Room 3: x: 40..400, y: 310..550. Shelves Row 1: y=390, Row 2: y=475. Width: 80, Height: 34
  const getShelfPosition = (room: number, shelf: number) => {
    const s = Math.min(6, Math.max(1, shelf));
    const col = (s - 1) % 3; // 0, 1, 2
    const row = Math.floor((s - 1) / 3); // 0 (row 1) or 1 (row 2)
    const normRoom = ((room - 1) % 3) + 1; // 1, 2, or 3

    if (normRoom === 1) {
      return { x: 70 + col * 110, y: 120 + row * 85, w: 80, h: 34 };
    } else if (normRoom === 2) {
      return { x: 570 + col * 110, y: 120 + row * 85, w: 80, h: 34 };
    } else {
      // Room 3
      return { x: 70 + col * 110, y: 390 + row * 85, w: 80, h: 34 };
    }
  };

  const targetRoom = parsed.roomNum;
  const targetShelf = parsed.shelfNum;
  const normRoom = ((targetRoom - 1) % 3) + 1;
  const targetShelfPos = getShelfPosition(targetRoom, targetShelf);
  const isRow2 = targetShelf > 3;

  // Realistic Wayfinding Waypoints (Path walks down dedicated center aisles, NEVER cutting across shelf text!)
  const waypoints = useMemo(() => {
    const entrance = { x: 635, y: 520 };
    const corridorCenter = { x: 470, y: 520 };
    const shelfCenterX = targetShelfPos.x + targetShelfPos.w / 2;

    if (normRoom === 1) {
      const door = { x: 400, y: 180 };
      const aisleY = 180;
      // Approach shelf face directly from the aisle without cutting into the shelf
      const targetArrivalY = isRow2 ? targetShelfPos.y - 6 : targetShelfPos.y + targetShelfPos.h + 6;
      return [
        entrance,
        corridorCenter,
        { x: 470, y: 180 },
        door,
        { x: shelfCenterX, y: aisleY },
        { x: shelfCenterX, y: targetArrivalY }
      ];
    } else if (normRoom === 2) {
      const door = { x: 540, y: 180 };
      const aisleY = 180;
      const targetArrivalY = isRow2 ? targetShelfPos.y - 6 : targetShelfPos.y + targetShelfPos.h + 6;
      return [
        entrance,
        corridorCenter,
        { x: 470, y: 180 },
        door,
        { x: shelfCenterX, y: aisleY },
        { x: shelfCenterX, y: targetArrivalY }
      ];
    } else {
      // Room 3
      const door = { x: 400, y: 450 };
      const aisleY = 450;
      const targetArrivalY = isRow2 ? targetShelfPos.y - 6 : targetShelfPos.y + targetShelfPos.h + 6;
      return [
        entrance,
        corridorCenter,
        { x: 470, y: 450 },
        door,
        { x: shelfCenterX, y: aisleY },
        { x: shelfCenterX, y: targetArrivalY }
      ];
    }
  }, [normRoom, targetShelfPos, isRow2]);

  // Construct SVG Path String
  const pathD = useMemo(() => {
    return waypoints.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, "");
  }, [waypoints]);

  // Simulation Walking Logic
  const handleToggleSimulation = () => {
    if (isSimulating) {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      setIsSimulating(false);
    } else {
      setIsSimulating(true);
      setSimStep(0);
      if (simTimerRef.current) clearInterval(simTimerRef.current);

      const totalSteps = 100;
      let current = 0;
      simTimerRef.current = setInterval(() => {
        current += 2;
        if (current > totalSteps) {
          clearInterval(simTimerRef.current);
          setIsSimulating(false);
          setSimStep(totalSteps);
          toast.success("Đã đến đúng kệ sách mục tiêu!");
        } else {
          setSimStep(current);
        }
      }, 70);
    }
  };

  // Calculate current walker position along path
  const walkerPos = useMemo(() => {
    if (waypoints.length < 2) return waypoints[0] || { x: 0, y: 0 };
    const segmentCount = waypoints.length - 1;
    const progressNorm = simStep / 100;
    const targetSegFloat = progressNorm * segmentCount;
    const segIdx = Math.min(Math.floor(targetSegFloat), segmentCount - 1);
    const segProgress = targetSegFloat - segIdx;

    const pA = waypoints[segIdx];
    const pB = waypoints[segIdx + 1];

    return {
      x: pA.x + (pB.x - pA.x) * segProgress,
      y: pA.y + (pB.y - pA.y) * segProgress,
    };
  }, [waypoints, simStep]);

  // AI Voice Guidance (Web Speech Synthesis)
  const handleToggleVoice = () => {
    if (!("speechSynthesis" in window)) {
      toast.error("Trình duyệt của bạn không hỗ trợ đọc giọng nói");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const titleText = bookTitle ? `cuốn sách ${bookTitle}` : "cuốn sách bạn đang tìm";
    const speechText = `Chào bạn. Để tìm ${titleText}, bạn đang ở Tầng ${parsed.floorNum}. Hãy đi thẳng từ Cửa vào chính dọc theo hành lang trung tâm. Rẽ vào ${parsed.roomLabel}, tìm dãy ${parsed.shelfLabel}. Cuốn sách được xếp ở ${parsed.rackLabel}, ngay tầm mắt của bạn. Chúc bạn tìm sách thuận lợi!`;

    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = "vi-VN";
    utterance.rate = 0.95;

    const voices = window.speechSynthesis.getVoices();
    const viVoice = voices.find((v) => v.lang.includes("vi"));
    if (viVoice) utterance.voice = viVoice;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const handleCopyGuide = () => {
    const text = `🗺️ SƠ ĐỒ ĐỊNH VỊ SÁCH ATHENAEUM: «${bookTitle || "Ấn phẩm thư viện"}»\n• Vị trí: ${parsed.roomLabel} - ${parsed.shelfLabel} - ${parsed.rackLabel}\n• Tầng: Tầng ${parsed.floorNum}\n• Khoảng cách: ~18 mét (khoảng 25 bước chân từ cửa chính)\n• Hướng dẫn chi tiết: Đi vào từ Cửa chính -> Dọc hành lang trung tâm -> Rẽ vào ${parsed.roomLabel} -> Dãy ${parsed.shelfLabel} -> Lấy sách tại ${parsed.rackLabel} (Tầng ${parsed.rackNum} từ dưới lên).`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Đã sao chép lộ trình định vị kệ sách vào bộ nhớ tạm!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[96vw] sm:w-full p-0 overflow-hidden max-h-[92vh] flex flex-col rounded-2xl border-2 border-primary/30 shadow-2xl bg-card">
        <style>{`
          @keyframes laserFlow {
            to {
              stroke-dashoffset: -36;
            }
          }
          @keyframes radarPing {
            0% { transform: scale(0.8); opacity: 1; }
            50% { transform: scale(1.6); opacity: 0.35; }
            100% { transform: scale(2.2); opacity: 0; }
          }
          @keyframes haloGlow {
            0%, 100% { filter: drop-shadow(0 0 6px rgba(6, 182, 212, 0.7)); }
            50% { filter: drop-shadow(0 0 16px rgba(59, 130, 246, 0.9)); }
          }
          .animate-laser-flow {
            stroke-dasharray: 10 8;
            animation: laserFlow 1.2s linear infinite;
          }
          .animate-radar-ring {
            animation: radarPing 2.2s cubic-bezier(0, 0, 0.2, 1) infinite;
            transform-origin: center;
          }
          .animate-halo-glow {
            animation: haloGlow 2.5s ease-in-out infinite;
          }
        `}</style>

        {/* ========================================================================= */}
        {/* 1. HERO HEADER: High-Tech Glassmorphism Header with Coordinates & IPS */}
        {/* ========================================================================= */}
        <DialogHeader className="p-4 sm:p-5 pb-3 border-b bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white relative shrink-0">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5">
            {/* Title & Live IPS Status */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="h-8 w-8 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 grid place-items-center shadow-xs">
                  <Compass className="h-4.5 w-4.5 animate-spin" style={{ animationDuration: "20s" }} />
                </div>
                <div>
                  <DialogTitle className="font-display text-base sm:text-lg font-black text-white flex items-center gap-2">
                    <span>Sơ Đồ Dẫn Đường Không Gian Số (Indoor IPS)</span>
                  </DialogTitle>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-mono font-bold px-2 py-0.5">
                  🛰️ Định Vị Trực Tiếp • Sai Số &lt; 0.5m
                </Badge>
              </div>
              <DialogDescription className="text-slate-300 text-xs">
                Hệ thống định vị thông minh dẫn đường chính xác từ cửa vào tới từng ngăn sách trên giá
              </DialogDescription>
            </div>

            {/* Target Book Pill with Protected Whitespace (Không bao giờ rớt dòng xấu xí!) */}
            <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md p-2.5 sm:px-3.5 rounded-2xl border border-white/20 shadow-md">
              {coverImage ? (
                <img
                  src={coverImage}
                  alt={bookTitle || "Sách"}
                  className="h-12 w-9 object-cover rounded-md shadow-md border border-white/30 shrink-0"
                />
              ) : (
                <div className="h-12 w-9 rounded-md bg-cyan-600/30 text-cyan-200 border border-cyan-400/30 grid place-items-center text-sm font-bold shrink-0">
                  📖
                </div>
              )}
              <div className="min-w-0 pr-1">
                <p className="font-bold text-xs sm:text-sm text-white truncate max-w-[220px] sm:max-w-[300px]">
                  {bookTitle || "Ấn phẩm thư viện"}
                </p>
                <p className="text-[11px] text-slate-300 truncate">
                  {authorName ? `Tác giả: ${authorName}` : "Thư viện Athenaeum"}
                </p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[11px] font-mono font-bold text-cyan-200 bg-cyan-500/30 px-2.5 py-0.5 rounded-md border border-cyan-400/40 whitespace-nowrap shrink-0">
                    📍 {parsed.roomLabel} • {parsed.shelfLabel} • {parsed.rackLabel}
                  </span>
                  <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-400/40 bg-emerald-500/10 whitespace-nowrap shrink-0">
                    Tầng {parsed.floorNum}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Sub Navigation Bar: Floors, View Modes, Voice AI & Sharing */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 mt-3 border-t border-white/10">
            {/* Floor Switcher */}
            <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setActiveFloor(1)}
                className={`px-3 py-1 rounded-lg transition-all font-medium flex items-center gap-1.5 cursor-pointer ${
                  activeFloor === 1
                    ? "bg-cyan-600 text-white shadow-md font-bold"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Building className="h-3.5 w-3.5" />
                <span>Tầng 1 (Kho A - C &amp; Quầy Lưu Thông)</span>
                {parsed.floorNum === 1 && (
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveFloor(2)}
                className={`px-3 py-1 rounded-lg transition-all font-medium flex items-center gap-1.5 cursor-pointer ${
                  activeFloor === 2
                    ? "bg-cyan-600 text-white shadow-md font-bold"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Building className="h-3.5 w-3.5" />
                <span>Tầng 2 (Kho D - F &amp; Phòng Nghiên Cứu)</span>
                {parsed.floorNum === 2 && (
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                )}
              </button>
            </div>

            {/* View Mode Tabs */}
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                <TabsList className="h-8 text-xs bg-black/40 p-1 rounded-xl border border-white/10 text-slate-300">
                  <TabsTrigger value="map" className="h-6 text-[11px] gap-1 px-2.5 cursor-pointer data-[state=active]:bg-white/20 data-[state=active]:text-white">
                    <Compass className="h-3.5 w-3.5 text-cyan-300" /> Bản đồ mặt bằng
                  </TabsTrigger>
                  <TabsTrigger value="shelf" className="h-6 text-[11px] gap-1 px-2.5 cursor-pointer data-[state=active]:bg-white/20 data-[state=active]:text-white">
                    <Layers className="h-3.5 w-3.5 text-amber-300" /> Mặt cắt giá kệ
                  </TabsTrigger>
                  <TabsTrigger value="steps" className="h-6 text-[11px] gap-1 px-2.5 cursor-pointer data-[state=active]:bg-white/20 data-[state=active]:text-white">
                    <Footprints className="h-3.5 w-3.5 text-emerald-300" /> Lộ trình bước
                  </TabsTrigger>
                  <TabsTrigger value="mobile" className="h-6 text-[11px] gap-1 px-2.5 cursor-pointer data-[state=active]:bg-white/20 data-[state=active]:text-white">
                    <QrCode className="h-3.5 w-3.5 text-pink-300" /> Mang theo mobile
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* AI Voice Guidance Button */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleToggleVoice}
                className={`h-8 text-xs gap-1.5 px-3 rounded-xl border cursor-pointer transition-all ${
                  isSpeaking
                    ? "bg-rose-500 hover:bg-rose-600 text-white border-rose-400 animate-pulse"
                    : "bg-white/10 hover:bg-white/20 text-white border-white/20"
                }`}
                title="Nghe chỉ đường bằng giọng nói AI"
              >
                {isSpeaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5 text-cyan-300" />}
                <span className="hidden sm:inline">{isSpeaking ? "Dừng giọng nói" : "Nghe thuyết minh"}</span>
              </Button>

              {/* Copy Guide Button */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyGuide}
                className="h-8 text-xs gap-1 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white border-white/20 cursor-pointer"
                title="Sao chép lộ trình chỉ dẫn"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="hidden md:inline">{copied ? "Đã chép" : "Chép chỉ đường"}</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ========================================================================= */}
        {/* 2. MODAL BODY: Interactive Content Area based on Selected Tab */}
        {/* ========================================================================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-muted/10">
          {/* TAB 1: 2.5D HIGH-TECH ARCHITECTURAL BLUEPRINT MAP */}
          {activeTab === "map" && (
            <div className="space-y-3.5 animate-in fade-in-50 duration-200">
              {/* Map Floating Toolbar & Telemetry */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-2xl bg-card border border-border/70 shadow-xs">
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
                    <Navigation className="h-4 w-4 text-cyan-500" />
                    Lộ trình:
                  </span>
                  <span className="text-muted-foreground font-mono">
                    ~18m • 25 bước chân • ~30 giây đi bộ
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px] bg-primary/5 text-primary border-primary/20">
                    Độ chính xác: 99.8%
                  </Badge>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                  {/* Simulation Walking Controls */}
                  <Button
                    size="sm"
                    variant={isSimulating ? "destructive" : "default"}
                    onClick={handleToggleSimulation}
                    className="h-7 text-xs gap-1.5 px-3 rounded-lg shadow-xs cursor-pointer"
                  >
                    {isSimulating ? (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" /> Dừng mô phỏng ({simStep}%)
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" /> 🚶‍♂️ Mô phỏng bước đi
                      </>
                    )}
                  </Button>

                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border">
                    <button
                      type="button"
                      onClick={() => setZoomLevel((z) => Math.max(0.8, Number((z - 0.15).toFixed(2))))}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-card text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Thu nhỏ"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[10px] font-mono px-1 font-semibold text-foreground">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoomLevel((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-card text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Phóng to"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomLevel(1)}
                      className="h-6 w-6 grid place-items-center rounded hover:bg-card text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Mặc định"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 2D / 2.5D SVG Floor Plan Display (viewBox: 0 0 940 600 - Rộng rãi, không bao giờ bị cắt!) */}
              <div className="relative w-full rounded-2xl border-2 border-slate-800 bg-[#0A0F1D] overflow-hidden shadow-xl">
                {/* Compass & North Direction */}
                <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-cyan-500/30 text-[11px] font-mono shadow-md text-cyan-200">
                  <span className="font-bold">Bắc (N)</span>
                  <Compass className="h-4 w-4 text-cyan-400 animate-spin" style={{ animationDuration: "16s" }} />
                </div>

                {/* Level Tag Overlay */}
                <div className="absolute top-3.5 left-3.5 z-10 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-[11px] font-mono shadow-md text-white">
                  <Building className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="font-bold">Mặt Bằng Tầng {activeFloor}</span>
                  <span className="text-slate-400">• Cao độ +{activeFloor === 1 ? "0.0m" : "3.8m"}</span>
                </div>

                {/* SVG Blueprint Canvas */}
                <div
                  className="w-full overflow-auto transition-transform duration-200"
                  style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center center" }}
                >
                  <svg
                    viewBox="0 0 940 600"
                    className="w-full h-auto aspect-[940/600] select-none font-sans min-h-[320px] sm:min-h-[480px]"
                  >
                    <defs>
                      {/* Blueprint Grid */}
                      <pattern id="archGrid" width="24" height="24" patternUnits="userSpaceOnUse">
                        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1E293B" strokeWidth="0.8" />
                      </pattern>
                      <pattern id="majorGrid" width="120" height="120" patternUnits="userSpaceOnUse">
                        <path d="M 120 0 L 0 0 0 120" fill="none" stroke="#334155" strokeWidth="1.2" strokeOpacity="0.4" />
                      </pattern>

                      {/* Neon Gradients */}
                      <linearGradient id="neonLaserGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="50%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#10b981" />
                      </linearGradient>

                      <linearGradient id="targetShelfNeon" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.95" />
                        <stop offset="100%" stopColor="#2563eb" stopOpacity="1" />
                      </linearGradient>

                      <linearGradient id="roomBgGlow" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#1e293b" stopOpacity="0.75" />
                        <stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
                      </linearGradient>

                      {/* Arrow Head */}
                      <marker id="neonArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 1 L 9 5 L 0 9 z" fill="#06b6d4" />
                      </marker>
                    </defs>

                    {/* Canvas Background & Blueprint Grids */}
                    <rect width="940" height="600" fill="#090E1A" />
                    <rect width="940" height="600" fill="url(#archGrid)" />
                    <rect width="940" height="600" fill="url(#majorGrid)" />

                    {/* ======================================================== */}
                    {/* ZONE 1 (TOP-LEFT): ROOM 01 (TẦNG 1) / ROOM 04 (TẦNG 2) */}
                    {/* ======================================================== */}
                    <g className={`transition-all duration-300 ${activeFloor === parsed.floorNum && normRoom === 1 ? "opacity-100" : "opacity-80"}`}>
                      <rect
                        x="40"
                        y="40"
                        width="360"
                        height="240"
                        rx="16"
                        fill="url(#roomBgGlow)"
                        stroke={activeFloor === parsed.floorNum && normRoom === 1 ? "#06b6d4" : "#334155"}
                        strokeWidth={activeFloor === parsed.floorNum && normRoom === 1 ? "2.5" : "1.5"}
                        className={activeFloor === parsed.floorNum && normRoom === 1 ? "animate-halo-glow" : ""}
                      />
                      {/* Entry Door on Right Wall (Aisle 2 at y=180) */}
                      <rect x="396" y="160" width="8" height="40" fill="#06b6d4" rx="2" fillOpacity={activeFloor === parsed.floorNum && normRoom === 1 ? 0.9 : 0.3} />
                      <text x="390" y="184" fontSize="9" fill="#94A3B8" textAnchor="end" fontWeight="bold">🚪 Cửa</text>

                      {/* Room Header & Icon (Spacious & Compact, No Overflow) */}
                      <rect x="55" y="50" width="28" height="28" rx="8" fill="#06b6d4" fillOpacity="0.2" />
                      <text x="69" y="69" fontSize="14" fill="#38bdf8" textAnchor="middle">🧪</text>
                      <text x="92" y="64" fontSize="12.5" fontWeight="bold" fill="#F8FAFC">
                        {activeFloor === 1 ? "Phòng 01 — Kho Sách A" : "Phòng 04 — Kho Sách D"}
                      </text>
                      <text x="92" y="78" fontSize="10" fill="#38BDF8" fontWeight="600">
                        {activeFloor === 1 ? "Khoa Học Tự Nhiên & Nghiên Cứu" : "Kinh Tế & Quản Trị Kinh Doanh"}
                      </text>
                      <text x="92" y="91" fontSize="8.5" fill="#94A3B8">
                        {activeFloor === 1 ? "Toán • Lý • Hóa • Sinh học • Kỷ yếu" : "Tài chính • Marketing • Khởi nghiệp"}
                      </text>

                      {/* 6 Shelves in Room 1 (K-01 to K-06) */}
                      {[1, 2, 3, 4, 5, 6].map((sNum) => {
                        const pos = getShelfPosition(1, sNum);
                        const isTarget = activeFloor === parsed.floorNum && normRoom === 1 && targetShelf === sNum;
                        return (
                          <g
                            key={`r1-shelf-${sNum}`}
                            className="cursor-pointer group"
                            onClick={() => {
                              setSelectedShelf({ room: activeFloor === 1 ? 1 : 4, shelf: sNum });
                              toast.info(`Đã chọn Kệ K-0${sNum} (Phòng 0${activeFloor === 1 ? 1 : 4})`);
                            }}
                          >
                            <rect
                              x={pos.x}
                              y={pos.y}
                              width={pos.w}
                              height={pos.h}
                              rx="8"
                              fill={isTarget ? "url(#targetShelfNeon)" : "#1E293B"}
                              stroke={isTarget ? "#38bdf8" : "#475569"}
                              strokeWidth={isTarget ? "2.5" : "1"}
                              className="transition-all duration-200 group-hover:stroke-cyan-400 group-hover:brightness-125"
                            />
                            {isTarget ? (
                              <g>
                                <text
                                  x={pos.x + pos.w / 2}
                                  y={pos.y + 14}
                                  fontSize="9.5"
                                  fontWeight="900"
                                  fill="#FFFFFF"
                                  textAnchor="middle"
                                >
                                  KỆ 0{sNum}
                                </text>
                                <text
                                  x={pos.x + pos.w / 2}
                                  y={pos.y + 26}
                                  fontSize="8.5"
                                  fontWeight="bold"
                                  fill="#FDE047"
                                  textAnchor="middle"
                                >
                                  ★ {parsed.rackLabel}
                                </text>
                                <circle cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2} r="26" fill="none" stroke="#06b6d4" strokeWidth="2" className="animate-radar-ring" />
                                <circle cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2} r="16" fill="none" stroke="#3b82f6" strokeWidth="1.5" className="animate-radar-ring" style={{ animationDelay: "1s" }} />
                              </g>
                            ) : (
                              <text
                                x={pos.x + pos.w / 2}
                                y={pos.y + pos.h / 2 + 4}
                                fontSize="11"
                                fontWeight="bold"
                                fill="#CBD5E1"
                                textAnchor="middle"
                              >
                                K-0{sNum}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>

                    {/* ======================================================== */}
                    {/* ZONE 2 (TOP-RIGHT): ROOM 02 (TẦNG 1) / ROOM 05 (TẦNG 2) */}
                    {/* ======================================================== */}
                    <g className={`transition-all duration-300 ${activeFloor === parsed.floorNum && normRoom === 2 ? "opacity-100" : "opacity-80"}`}>
                      <rect
                        x="540"
                        y="40"
                        width="360"
                        height="240"
                        rx="16"
                        fill="url(#roomBgGlow)"
                        stroke={activeFloor === parsed.floorNum && normRoom === 2 ? "#06b6d4" : "#334155"}
                        strokeWidth={activeFloor === parsed.floorNum && normRoom === 2 ? "2.5" : "1.5"}
                        className={activeFloor === parsed.floorNum && normRoom === 2 ? "animate-halo-glow" : ""}
                      />
                      {/* Entry Door on Left Wall (Aisle 2 at y=180) */}
                      <rect x="536" y="160" width="8" height="40" fill="#06b6d4" rx="2" fillOpacity={activeFloor === parsed.floorNum && normRoom === 2 ? 0.9 : 0.3} />
                      <text x="548" y="184" fontSize="9" fill="#94A3B8" fontWeight="bold">🚪 Cửa</text>

                      {/* Room Header & Icon */}
                      <rect x="555" y="50" width="28" height="28" rx="8" fill="#a855f7" fillOpacity="0.2" />
                      <text x="569" y="69" fontSize="14" fill="#c084fc" textAnchor="middle">🎭</text>
                      <text x="592" y="64" fontSize="12.5" fontWeight="bold" fill="#F8FAFC">
                        {activeFloor === 1 ? "Phòng 02 — Kho Sách B" : "Phòng 05 — Kho Sách E"}
                      </text>
                      <text x="592" y="78" fontSize="10" fill="#C084FC" fontWeight="600">
                        {activeFloor === 1 ? "Văn Học, Lịch Sử & Nghệ Thuật" : "Ngoại Ngữ & Từ Điển Quốc Tế"}
                      </text>
                      <text x="592" y="91" fontSize="8.5" fill="#94A3B8">
                        {activeFloor === 1 ? "Tiểu thuyết • Thơ ca • Triết học • Mỹ thuật" : "Tiếng Anh • Nhật • Hàn • Pháp"}
                      </text>

                      {/* 6 Shelves in Room 2 (K-01 to K-06) */}
                      {[1, 2, 3, 4, 5, 6].map((sNum) => {
                        const pos = getShelfPosition(2, sNum);
                        const isTarget = activeFloor === parsed.floorNum && normRoom === 2 && targetShelf === sNum;
                        return (
                          <g
                            key={`r2-shelf-${sNum}`}
                            className="cursor-pointer group"
                            onClick={() => {
                              setSelectedShelf({ room: activeFloor === 1 ? 2 : 5, shelf: sNum });
                              toast.info(`Đã chọn Kệ K-0${sNum} (Phòng 0${activeFloor === 1 ? 2 : 5})`);
                            }}
                          >
                            <rect
                              x={pos.x}
                              y={pos.y}
                              width={pos.w}
                              height={pos.h}
                              rx="8"
                              fill={isTarget ? "url(#targetShelfNeon)" : "#1E293B"}
                              stroke={isTarget ? "#38bdf8" : "#475569"}
                              strokeWidth={isTarget ? "2.5" : "1"}
                              className="transition-all duration-200 group-hover:stroke-cyan-400 group-hover:brightness-125"
                            />
                            {isTarget ? (
                              <g>
                                <text
                                  x={pos.x + pos.w / 2}
                                  y={pos.y + 14}
                                  fontSize="9.5"
                                  fontWeight="900"
                                  fill="#FFFFFF"
                                  textAnchor="middle"
                                >
                                  KỆ 0{sNum}
                                </text>
                                <text
                                  x={pos.x + pos.w / 2}
                                  y={pos.y + 26}
                                  fontSize="8.5"
                                  fontWeight="bold"
                                  fill="#FDE047"
                                  textAnchor="middle"
                                >
                                  ★ {parsed.rackLabel}
                                </text>
                                <circle cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2} r="26" fill="none" stroke="#06b6d4" strokeWidth="2" className="animate-radar-ring" />
                                <circle cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2} r="16" fill="none" stroke="#3b82f6" strokeWidth="1.5" className="animate-radar-ring" style={{ animationDelay: "1s" }} />
                              </g>
                            ) : (
                              <text
                                x={pos.x + pos.w / 2}
                                y={pos.y + pos.h / 2 + 4}
                                fontSize="11"
                                fontWeight="bold"
                                fill="#CBD5E1"
                                textAnchor="middle"
                              >
                                K-0{sNum}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>

                    {/* ======================================================== */}
                    {/* ZONE 3 (BOTTOM-LEFT): ROOM 03 (TẦNG 1) / ROOM 06 (TẦNG 2) */}
                    {/* ======================================================== */}
                    <g className={`transition-all duration-300 ${activeFloor === parsed.floorNum && normRoom === 3 ? "opacity-100" : "opacity-80"}`}>
                      <rect
                        x="40"
                        y="310"
                        width="360"
                        height="240"
                        rx="16"
                        fill="url(#roomBgGlow)"
                        stroke={activeFloor === parsed.floorNum && normRoom === 3 ? "#06b6d4" : "#334155"}
                        strokeWidth={activeFloor === parsed.floorNum && normRoom === 3 ? "2.5" : "1.5"}
                        className={activeFloor === parsed.floorNum && normRoom === 3 ? "animate-halo-glow" : ""}
                      />
                      {/* Entry Door on Right Wall (Aisle 2 at y=450) */}
                      <rect x="396" y="430" width="8" height="40" fill="#06b6d4" rx="2" fillOpacity={activeFloor === parsed.floorNum && normRoom === 3 ? 0.9 : 0.3} />
                      <text x="390" y="454" fontSize="9" fill="#94A3B8" textAnchor="end" fontWeight="bold">🚪 Cửa</text>

                      {/* Room Header & Icon */}
                      <rect x="55" y="320" width="28" height="28" rx="8" fill="#10b981" fillOpacity="0.2" />
                      <text x="69" y="339" fontSize="14" fill="#34d399" textAnchor="middle">💻</text>
                      <text x="92" y="334" fontSize="12.5" fontWeight="bold" fill="#F8FAFC">
                        {activeFloor === 1 ? "Phòng 03 — Kho Sách C" : "Phòng 06 — Kho Sách F"}
                      </text>
                      <text x="92" y="348" fontSize="10" fill="#34D399" fontWeight="600">
                        {activeFloor === 1 ? "Công Nghệ Thông Tin & Kỹ Năng Số" : "Báo Chí & Tài Liệu Đa Phương Tiện"}
                      </text>
                      <text x="92" y="361" fontSize="8.5" fill="#94A3B8">
                        {activeFloor === 1 ? "Lập trình • AI • Cloud • Dữ liệu • An ninh mạng" : "Báo chí • Tạp chí chuyên ngành • Luận án"}
                      </text>

                      {/* 6 Shelves in Room 3 (K-01 to K-06) */}
                      {[1, 2, 3, 4, 5, 6].map((sNum) => {
                        const pos = getShelfPosition(3, sNum);
                        const isTarget = activeFloor === parsed.floorNum && normRoom === 3 && targetShelf === sNum;
                        return (
                          <g
                            key={`r3-shelf-${sNum}`}
                            className="cursor-pointer group"
                            onClick={() => {
                              setSelectedShelf({ room: activeFloor === 1 ? 3 : 6, shelf: sNum });
                              toast.info(`Đã chọn Kệ K-0${sNum} (Phòng 0${activeFloor === 1 ? 3 : 6})`);
                            }}
                          >
                            <rect
                              x={pos.x}
                              y={pos.y}
                              width={pos.w}
                              height={pos.h}
                              rx="8"
                              fill={isTarget ? "url(#targetShelfNeon)" : "#1E293B"}
                              stroke={isTarget ? "#38bdf8" : "#475569"}
                              strokeWidth={isTarget ? "2.5" : "1"}
                              className="transition-all duration-200 group-hover:stroke-cyan-400 group-hover:brightness-125"
                            />
                            {isTarget ? (
                              <g>
                                <text
                                  x={pos.x + pos.w / 2}
                                  y={pos.y + 14}
                                  fontSize="9.5"
                                  fontWeight="900"
                                  fill="#FFFFFF"
                                  textAnchor="middle"
                                >
                                  KỆ 0{sNum}
                                </text>
                                <text
                                  x={pos.x + pos.w / 2}
                                  y={pos.y + 26}
                                  fontSize="8.5"
                                  fontWeight="bold"
                                  fill="#FDE047"
                                  textAnchor="middle"
                                >
                                  ★ {parsed.rackLabel}
                                </text>
                                <circle cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2} r="26" fill="none" stroke="#06b6d4" strokeWidth="2" className="animate-radar-ring" />
                                <circle cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2} r="16" fill="none" stroke="#3b82f6" strokeWidth="1.5" className="animate-radar-ring" style={{ animationDelay: "1s" }} />
                              </g>
                            ) : (
                              <text
                                x={pos.x + pos.w / 2}
                                y={pos.y + pos.h / 2 + 4}
                                fontSize="11"
                                fontWeight="bold"
                                fill="#CBD5E1"
                                textAnchor="middle"
                              >
                                K-0{sNum}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>

                    {/* ======================================================== */}
                    {/* ZONE 4: QUẦY THỦ THƯ LƯU THÔNG (BOTTOM-RIGHT - LIBRARIAN) */}
                    {/* ======================================================== */}
                    <g>
                      <rect
                        x="540"
                        y="310"
                        width="180"
                        height="145"
                        rx="14"
                        fill="#0F172A"
                        stroke="#334155"
                        strokeWidth="1.5"
                      />
                      <rect x="555" y="325" width="24" height="24" rx="6" fill="#f59e0b" fillOpacity="0.2" />
                      <text x="567" y="342" fontSize="13" fill="#fbbf24" textAnchor="middle">🛎️</text>
                      <text x="586" y="338" fontSize="12" fontWeight="bold" fill="#F8FAFC">
                        Quầy Thủ Thư
                      </text>
                      <text x="586" y="352" fontSize="9" fill="#94A3B8">
                        Bàn mượn trả &amp; tiếp đón
                      </text>

                      {/* Service Counter Table */}
                      <rect x="555" y="385" width="150" height="26" rx="6" fill="#1E293B" stroke="#475569" strokeWidth="1" />
                      <text x="630" y="402" fontSize="9" fontWeight="bold" fill="#38bdf8" textAnchor="middle">
                        🖥️ Quét mã &amp; Cấp sách
                      </text>
                    </g>

                    {/* ======================================================== */}
                    {/* ZONE 5: PHÒNG ĐỌC YÊN TĨNH & CO-WORKING (STUDY LOUNGE) */}
                    {/* ======================================================== */}
                    <g>
                      <rect
                        x="745"
                        y="310"
                        width="155"
                        height="165"
                        rx="14"
                        fill="#0F172A"
                        stroke="#334155"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                      />
                      <rect x="760" y="325" width="24" height="24" rx="6" fill="#10b981" fillOpacity="0.2" />
                      <text x="772" y="342" fontSize="13" fill="#34d399" textAnchor="middle">🛋️</text>
                      <text x="792" y="338" fontSize="11.5" fontWeight="bold" fill="#F8FAFC">
                        Phòng Tự Học
                      </text>
                      <text x="792" y="352" fontSize="8.5" fill="#94A3B8">
                        Không gian yên tĩnh
                      </text>

                      {/* Study Pods / Tables */}
                      <circle cx="785" cy="405" r="14" fill="#1E293B" stroke="#475569" strokeWidth="1" />
                      <circle cx="855" cy="405" r="14" fill="#1E293B" stroke="#475569" strokeWidth="1" />
                      <circle cx="785" cy="445" r="14" fill="#1E293B" stroke="#475569" strokeWidth="1" />
                      <circle cx="855" cy="445" r="14" fill="#1E293B" stroke="#475569" strokeWidth="1" />
                    </g>

                    {/* ======================================================== */}
                    {/* ZONE 6: CẦU THANG BỘ & THANG MÁY (STAIRS / ELEVATOR) */}
                    {/* ======================================================== */}
                    <g>
                      <rect
                        x="435"
                        y="40"
                        width="70"
                        height="85"
                        rx="12"
                        fill="#0F172A"
                        stroke="#334155"
                        strokeWidth="1.5"
                      />
                      <text x="470" y="68" fontSize="16" textAnchor="middle">🛗</text>
                      <text x="470" y="88" fontSize="10" fontWeight="bold" fill="#94A3B8" textAnchor="middle">
                        Thang Máy
                      </text>
                      <text x="470" y="103" fontSize="8.5" fill="#64748B" textAnchor="middle">
                        Tầng 1 ⇄ 2
                      </text>
                    </g>

                    {/* ======================================================== */}
                    {/* ZONE 7: SMART BOOK DROP 24/7 & CỔNG AN NINH RFID */}
                    {/* ======================================================== */}
                    <g>
                      {/* Smart Book Drop 24/7 Box */}
                      <g className="cursor-pointer" onClick={() => toast.info("Hòm trả sách thông minh 24/7 đặt tại sảnh chính")}>
                        <rect x="745" y="495" width="155" height="52" rx="12" fill="#1E1B4B" stroke="#6366F1" strokeWidth="1.5" />
                        <text x="765" y="526" fontSize="15">📦</text>
                        <text x="788" y="518" fontSize="11" fontWeight="bold" fill="#C7D2FE">Hòm Trả 24/7</text>
                        <text x="788" y="533" fontSize="8.5" fill="#818CF8">Nhận trả sách tự động</text>
                      </g>

                      {/* Main Entrance & RFID Security Gates */}
                      <rect x="550" y="495" width="170" height="52" rx="12" fill="#064E3B" stroke="#10B981" strokeWidth="2" />
                      <circle cx="570" cy="521" r="5" fill="#34D399" className="animate-ping" />
                      <text x="588" y="519" fontSize="12" fontWeight="black" fill="#ECFDF5">
                        🚪 CỬA VÀO CHÍNH
                      </text>
                      <text x="588" y="534" fontSize="8.5" fill="#A7F3D0">
                        Cổng an ninh RFID
                      </text>
                    </g>

                    {/* ======================================================== */}
                    {/* DYNAMIC WAYFINDING LASER PATH */}
                    {/* ======================================================== */}
                    {activeFloor === parsed.floorNum && (
                      <g>
                        {/* Neon Ambient Blur Glow */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="#06b6d4"
                          strokeWidth="10"
                          strokeOpacity="0.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {/* Solid Bright Core */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="url(#neonLaserGrad)"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {/* Moving Flowing Dash Beam */}
                        <path
                          d={pathD}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="animate-laser-flow"
                          markerEnd="url(#neonArrow)"
                        />

                        {/* Starting Pin at Entrance */}
                        <circle cx={waypoints[0].x} cy={waypoints[0].y} r="8" fill="#10B981" stroke="#FFFFFF" strokeWidth="2.5" />
                        <text x={waypoints[0].x} y={waypoints[0].y - 12} fontSize="10" fontWeight="black" fill="#34D399" textAnchor="middle">
                          BẮT ĐẦU
                        </text>

                        {/* Dynamic Floating Walker Marker during simulation */}
                        {isSimulating && (
                          <g transform={`translate(${walkerPos.x}, ${walkerPos.y})`}>
                            <circle r="14" fill="#06B6D4" fillOpacity="0.3" className="animate-ping" />
                            <circle r="9" fill="#06B6D4" stroke="#FFFFFF" strokeWidth="2.5" />
                            <text y="4" fontSize="11" textAnchor="middle">🚶</text>
                          </g>
                        )}

                        {/* Destination Arrival Beacon directly in aisle facing target shelf */}
                        {waypoints.length > 0 && (
                          <g>
                            <circle
                              cx={waypoints[waypoints.length - 1].x}
                              cy={waypoints[waypoints.length - 1].y}
                              r="5"
                              fill="#38BDF8"
                              stroke="#FFFFFF"
                              strokeWidth="2"
                            />
                            <circle
                              cx={waypoints[waypoints.length - 1].x}
                              cy={waypoints[waypoints.length - 1].y}
                              r="12"
                              fill="none"
                              stroke="#38BDF8"
                              strokeWidth="1.5"
                              className="animate-ping"
                            />
                          </g>
                        )}
                      </g>
                    )}
                  </svg>
                </div>
              </div>

              {/* Map Legend & Fast Coordinates Summary */}
              <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground bg-card p-3 rounded-xl border border-border/70 gap-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-xs" />
                    <span className="font-medium text-foreground">Cửa chính &amp; Cổng từ RFID</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-6 rounded bg-gradient-to-r from-cyan-500 to-blue-600 shadow-xs" />
                    <span className="font-bold text-cyan-600 dark:text-cyan-400">Kệ chứa sách đích</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-0.5 w-6 border-b-2 border-dashed border-cyan-400" />
                    <span>Lộ trình dẫn đường</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-indigo-600 shadow-xs" />
                    <span>Hòm trả 24/7 ngoài giờ</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-amber-500 shadow-xs" />
                    <span>Quầy thủ thư</span>
                  </div>
                </div>

                <div className="font-mono text-xs text-foreground font-bold bg-muted px-2.5 py-1 rounded-lg border whitespace-nowrap">
                  Vị trí: {parsed.roomLabel} — {parsed.shelfLabel} — {parsed.rackLabel}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: REALISTIC 5-TIER 3D BOOKSHELF ELEVATION */}
          {activeTab === "shelf" && (
            <div className="space-y-4 animate-in fade-in-50 duration-200">
              <div className="rounded-2xl border bg-card p-4 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b">
                  <div>
                    <h3 className="font-display font-bold text-base sm:text-lg flex items-center gap-2 text-foreground">
                      <Layers className="h-5 w-5 text-amber-500" />
                      <span>Mặt Cắt Đứng Dãy Kệ Thực Tế ({parsed.shelfLabel} — {parsed.roomLabel})</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Kệ sách vật lý tiêu chuẩn cao 2.0m gồm 5 tầng (ngăn). Cuốn sách bạn cần tìm được xếp chính xác tại{" "}
                      <strong className="text-cyan-600 dark:text-cyan-400 font-bold">{parsed.rackLabel}</strong>.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs text-amber-600 dark:text-amber-400 border-amber-500/30">
                      📐 Chiều cao: 2.0 mét • 5 Tầng
                    </Badge>
                  </div>
                </div>

                {/* 5-Tier Bookshelf Visualization */}
                <div className="max-w-2xl mx-auto py-2 space-y-3">
                  {[5, 4, 3, 2, 1].map((rNum) => {
                    const isTargetRack = parsed.rackNum === rNum;
                    const tierInfo =
                      rNum === 5
                        ? { label: "Tầng 5 (Ngăn đỉnh ~1.8m - 2.0m)", desc: "Sách tham khảo & kỷ yếu nghiên cứu ít lưu thông", eyeLevel: "Cần với cao" }
                        : rNum === 4
                        ? { label: "Tầng 4 (Ngăn trên ~1.5m - 1.8m)", desc: "Sách chuyên khảo & giáo trình học kỳ", eyeLevel: "Vừa tầm với" }
                        : rNum === 3
                        ? { label: "Tầng 3 (Tầm mắt ~1.2m - 1.5m)", desc: "Sách mượn nhiều nhất, dễ nhìn thấy nhất khi đứng", eyeLevel: "👁️ Ngang tầm mắt (Tối ưu)" }
                        : rNum === 2
                        ? { label: "Tầng 2 (Ngăn dưới ~0.6m - 1.2m)", desc: "Sách kỹ năng & ấn phẩm thường thức", eyeLevel: "Tầm cúi nhẹ" }
                        : { label: "Tầng 1 (Ngăn đáy ~0.0m - 0.6m)", desc: "Từ điển dày, sách khổ lớn & bộ bách khoa toàn thư", eyeLevel: "Ngăn đáy" };

                    return (
                      <div
                        key={`shelf-tier-${rNum}`}
                        className={`relative rounded-2xl border-2 transition-all p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isTargetRack
                            ? "border-cyan-500 bg-cyan-50/20 dark:bg-cyan-950/25 shadow-lg ring-4 ring-cyan-500/10 scale-[1.01]"
                            : "border-border/70 bg-card hover:bg-muted/20"
                        }`}
                      >
                        {/* Rack Badge & Title */}
                        <div className="flex items-start gap-3.5 min-w-0">
                          <div
                            className={`h-10 w-10 rounded-xl grid place-items-center font-bold text-xs font-mono shrink-0 shadow-xs ${
                              isTargetRack
                                ? "bg-cyan-600 text-white"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            N-0{rNum}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`text-xs sm:text-sm font-bold ${isTargetRack ? "text-cyan-600 dark:text-cyan-400 font-display" : "text-foreground"}`}>
                                {tierInfo.label}
                              </p>
                              {isTargetRack && (
                                <Badge className="bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold gap-1 animate-pulse">
                                  🎯 VỊ TRÍ CUỐN SÁCH CẦN TÌM
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                                {tierInfo.eyeLevel}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {tierInfo.desc}
                            </p>
                          </div>
                        </div>

                        {/* Visual Books on Shelf Shelf Simulation */}
                        <div className="flex items-end gap-1 shrink-0 h-10 px-2 py-1 rounded-lg bg-muted/40 border border-border/50 self-end sm:self-center">
                          {isTargetRack ? (
                            <div className="flex items-center gap-2 px-3 py-1 rounded bg-cyan-600 text-white font-bold text-xs shadow-xs animate-bounce" style={{ animationDuration: "2s" }}>
                              <BookOpen className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate max-w-[140px] text-[11px]">
                                {bookTitle || "Sách ở đây"}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-end gap-1 opacity-70">
                              <div className="w-2 h-7 bg-red-400 rounded-t-xs" />
                              <div className="w-2.5 h-9 bg-blue-500 rounded-t-xs" />
                              <div className="w-1.5 h-6 bg-emerald-400 rounded-t-xs" />
                              <div className="w-2.5 h-8 bg-amber-400 rounded-t-xs" />
                              <div className="w-2 h-7 bg-purple-400 rounded-t-xs" />
                              <div className="w-2 h-9 bg-indigo-500 rounded-t-xs" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-xs text-muted-foreground bg-muted/40 p-3.5 rounded-xl border flex items-start gap-2.5">
                  <Info className="h-4 w-4 text-cyan-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">
                      Quy tắc xếp sách trên giá:
                    </p>
                    <p className="leading-relaxed">
                      Sách trên kệ được xếp theo thứ tự mã số phân loại Dewey (DDC) và tiêu đề từ trái qua phải, từ ngăn trên xuống ngăn dưới. Khi đến trước dãy <strong>{parsed.shelfLabel}</strong>, bạn đếm từ đáy lên ngăn số <strong>0{parsed.rackNum}</strong> để lấy sách ngay lập tức!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TURN-BY-TURN STEP GPS GUIDANCE & AI VOICE */}
          {activeTab === "steps" && (
            <div className="space-y-4 animate-in fade-in-50 duration-200">
              <div className="rounded-2xl border bg-card p-4 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b">
                  <div>
                    <h3 className="font-display font-bold text-base sm:text-lg flex items-center gap-2 text-foreground">
                      <Footprints className="h-5 w-5 text-emerald-600" />
                      <span>Lộ Trình Từng Bước Đến Cuốn Sách</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Chỉ dẫn đường đi ngắn nhất, tránh vật cản và đến thẳng vị trí cuốn sách
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToggleVoice}
                    className="h-8 text-xs gap-1.5 text-cyan-700 dark:text-cyan-300 border-cyan-500/30 bg-cyan-50/20 dark:bg-cyan-950/20 hover:bg-cyan-50 cursor-pointer"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    <span>{isSpeaking ? "Đang đọc thuyết minh..." : "Phát âm thanh chỉ đường"}</span>
                  </Button>
                </div>

                {/* Timeline Cards */}
                <div className="space-y-3">
                  {[
                    {
                      step: 1,
                      icon: "🚪",
                      title: "Cửa vào chính & Cổng từ RFID an ninh",
                      desc: `Bước qua cửa kính chính ở Tầng ${parsed.floorNum}. Bạn sẽ thấy Cổng từ an ninh và khu vực đón tiếp độc giả.`,
                      dist: "0 mét",
                      action: "Xuất phát",
                    },
                    {
                      step: 2,
                      icon: "🚶",
                      title: "Đi dọc Hành lang trung tâm",
                      desc:
                        parsed.floorNum === 2
                          ? "Đi thẳng tới cuối hành lang, sử dụng Thang máy hoặc Cầu thang bộ để lên Tầng 2."
                          : "Đi thẳng khoảng 10 mét dọc theo hành lang trung tâm giữa dãy Phòng 01 và Phòng 02.",
                      dist: "Khoảng 10m",
                      action: "Đi thẳng",
                    },
                    {
                      step: 3,
                      icon: "🚪",
                      title: `Rẽ vào ${parsed.roomLabel}`,
                      desc: `Bước qua cửa của ${parsed.roomLabel}. Quan sát biển tên phòng và bản đồ số mini treo tại cửa.`,
                      dist: "Khoảng 14m",
                      action: "Rẽ vào phòng",
                    },
                    {
                      step: 4,
                      icon: "📚",
                      title: `Tiến đến dãy ${parsed.shelfLabel}`,
                      desc: `Xác định dãy ${parsed.shelfLabel} (được treo biển số K-0${parsed.shelfNum} phản quang ở đầu dãy).`,
                      dist: "Khoảng 18m",
                      action: "Xác định kệ",
                    },
                    {
                      step: 5,
                      icon: "🎯",
                      title: `Lấy sách tại ${parsed.rackLabel}`,
                      desc: `Đếm từ đáy kệ lên ngăn số 0${parsed.rackNum}. Cuốn sách «${
                        bookTitle || "sách cần tìm"
                      }» nằm tại vị trí này. Quét mã QR tem gáy để đối soát và mang tới quầy mượn!`,
                      dist: "Đích đến",
                      action: "Lấy sách",
                    },
                  ].map((s) => (
                    <div
                      key={s.step}
                      className="flex items-start gap-3.5 p-3.5 rounded-xl border border-border/70 bg-card hover:border-primary/40 transition-all shadow-2xs"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary border border-primary/20 font-bold text-xs grid place-items-center shrink-0 shadow-2xs mt-0.5">
                        {s.step}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-bold text-xs sm:text-sm text-foreground flex items-center gap-1.5">
                            <span>{s.icon}</span>
                            <span>{s.title}</span>
                          </p>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] font-mono font-semibold">
                              {s.dist}
                            </Badge>
                            <Badge className="bg-primary/10 text-primary hover:bg-primary/20 text-[10px]">
                              {s.action}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {s.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MOBILE QR WAYFINDING PASS (MANG THEO MOBILE) */}
          {activeTab === "mobile" && (
            <div className="space-y-4 animate-in fade-in-50 duration-200">
              <div className="rounded-2xl border bg-card p-4 sm:p-6 shadow-xs flex flex-col items-center text-center space-y-4 max-w-lg mx-auto">
                <div className="h-12 w-12 rounded-2xl bg-pink-500/10 text-pink-500 grid place-items-center">
                  <QrCode className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-foreground">
                    Thẻ Dẫn Đường Trên Điện Thoại (Mobile Navigation Pass)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Dùng camera điện thoại quét mã QR bên dưới để mở sơ đồ dẫn đường này trên di động khi đang đi tìm sách
                  </p>
                </div>

                {/* QR Code Canvas */}
                <div className="p-4 bg-white rounded-2xl border-2 border-primary/40 shadow-md">
                  <QRCodeCanvas
                    id="mobile-minimap-qr"
                    value={`https://athenaeum.lib/nav?room=${parsed.roomNum}&shelf=${parsed.shelfNum}&rack=${parsed.rackNum}&floor=${parsed.floorNum}&book=${encodeURIComponent(bookTitle || "")}`}
                    size={180}
                    level="H"
                    includeMargin={true}
                    className="rounded-lg"
                  />
                  <code className="text-[11px] font-mono font-bold text-primary block mt-2 whitespace-nowrap">
                    {parsed.roomLabel} — {parsed.shelfLabel} — {parsed.rackLabel}
                  </code>
                </div>

                <div className="w-full space-y-2 text-xs">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5 cursor-pointer"
                    onClick={handleCopyGuide}
                  >
                    <Copy className="h-3.5 w-3.5" /> Sao chép văn bản chỉ đường
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 3. MODAL FOOTER */}
        {/* ========================================================================= */}
        <div className="p-3.5 sm:p-4 border-t bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <MapPin className="h-4 w-4 text-cyan-600 shrink-0" />
            <span className="whitespace-nowrap truncate">
              Tọa độ: <strong className="text-foreground">{parsed.roomLabel}</strong> — <strong className="text-foreground">{parsed.shelfLabel}</strong> — <strong className="text-foreground">{parsed.rackLabel}</strong> (Tầng {parsed.floorNum})
            </span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-8 cursor-pointer"
            >
              Đóng
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCopyGuide}
              className="text-xs h-8 gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold cursor-pointer shadow-xs"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Chia sẻ lộ trình</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
