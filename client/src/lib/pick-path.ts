/**
 * Multi-Book Pick Path Optimizer (Lộ Trình Đi Lấy Nhiều Sách Tối Ưu Trong Thư Viện)
 * Sắp xếp tự động các cuốn sách trong Phiếu mượn nháp theo thứ tự không gian tối ưu:
 * Phòng gần sảnh chính nhất (Phòng 01 -> 02 -> ...) -> Kệ thấp đến Kệ cao (Kệ 01 -> 02 -> ...) -> Ngăn dưới lên Ngăn trên (Ngăn 01 -> 02 -> ...)
 */

export interface PickPathParsedLocation {
  roomNum: number;
  shelfNum: number;
  rackNum: number;
  roomLabel: string;
  shelfLabel: string;
  rackLabel: string;
  fullLabel: string;
}

export interface PickPathEnrichedItem<T = any> {
  item: T;
  stepOrder: number; // 1, 2, 3...
  parsedLocation: PickPathParsedLocation;
  transitionType: "start" | "same_shelf" | "same_room" | "next_room";
  transitionHint: string;
}

export interface MultiBookPickPathResult<T = any> {
  orderedItems: Array<T & { _pickPath: PickPathEnrichedItem<T> }>;
  roomsSequence: string[];
  uniqueShelvesCount: number;
  routeSummaryText: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function parseBookLocationForPickPath(rawLocation?: string | null): PickPathParsedLocation {
  const raw = (rawLocation || "Phòng 01 - Kệ 01 - Ngăn 01").trim();

  const roomMatch = raw.match(/Phòng\s*(\d+)/i) || raw.match(/Phong\s*(\d+)/i);
  const shelfMatch = raw.match(/Kệ\s*(\d+)/i) || raw.match(/Ke\s*(\d+)/i) || raw.match(/Dãy\s*(\d+)/i);
  const rackMatch = raw.match(/Ngăn\s*(\d+)/i) || raw.match(/Ngan\s*(\d+)/i) || raw.match(/Tầng\s*(\d+)/i);

  const roomNum = roomMatch ? parseInt(roomMatch[1], 10) : 1;
  const shelfNum = shelfMatch ? parseInt(shelfMatch[1], 10) : 1;
  const rackNum = rackMatch ? parseInt(rackMatch[1], 10) : 1;

  const roomLabel = `Phòng ${pad2(roomNum)}`;
  const shelfLabel = `Kệ ${pad2(shelfNum)}`;
  const rackLabel = `Ngăn ${pad2(rackNum)}`;

  return {
    roomNum,
    shelfNum,
    rackNum,
    roomLabel,
    shelfLabel,
    rackLabel,
    fullLabel: `${roomLabel} - ${shelfLabel} - ${rackLabel}`,
  };
}

export function optimizeMultiBookPickPath<T extends { location?: string | null; book_title?: string; title?: string }>(
  items: T[] | undefined | null
): MultiBookPickPathResult<T> {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return {
      orderedItems: [],
      roomsSequence: [],
      uniqueShelvesCount: 0,
      routeSummaryText: "",
    };
  }

  const withParsed = items.map((item, originalIdx) => ({
    item,
    originalIdx,
    loc: parseBookLocationForPickPath(item.location),
  }));

  // Sắp xếp theo: Phòng (tăng dần) -> Kệ (tăng dần) -> Ngăn (dưới lên trên tăng dần)
  withParsed.sort((a, b) => {
    if (a.loc.roomNum !== b.loc.roomNum) return a.loc.roomNum - b.loc.roomNum;
    if (a.loc.shelfNum !== b.loc.shelfNum) return a.loc.shelfNum - b.loc.shelfNum;
    if (a.loc.rackNum !== b.loc.rackNum) return a.loc.rackNum - b.loc.rackNum;
    return a.originalIdx - b.originalIdx;
  });

  const roomsSet: string[] = [];
  const shelvesSet = new Set<string>();

  const orderedItems = withParsed.map((entry, idx) => {
    const { item, loc } = entry;
    const stepOrder = idx + 1;

    if (!roomsSet.includes(loc.roomLabel)) {
      roomsSet.push(loc.roomLabel);
    }
    shelvesSet.add(`${loc.roomLabel}-${loc.shelfLabel}`);

    let transitionType: "start" | "same_shelf" | "same_room" | "next_room" = "start";
    let transitionHint = "";

    if (idx === 0) {
      transitionType = "start";
      transitionHint = `Xuất phát từ Sảnh chính → Vào ${loc.roomLabel} → Đến ${loc.shelfLabel} → Lấy ở ${loc.rackLabel} (từ dưới đếm lên)`;
    } else {
      const prevLoc = withParsed[idx - 1].loc;
      if (prevLoc.roomNum === loc.roomNum && prevLoc.shelfNum === loc.shelfNum) {
        transitionType = "same_shelf";
        if (prevLoc.rackNum === loc.rackNum) {
          transitionHint = `Đứng tại chỗ (${loc.roomLabel} • ${loc.shelfLabel}) → Lấy tiếp tại cùng ${loc.rackLabel}`;
        } else {
          transitionHint = `Đứng tại chỗ (${loc.roomLabel} • ${loc.shelfLabel}) → Nhìn từ ${prevLoc.rackLabel} lên ${loc.rackLabel}`;
        }
      } else if (prevLoc.roomNum === loc.roomNum) {
        transitionType = "same_room";
        transitionHint = `Ở trong ${loc.roomLabel} → Đi từ ${prevLoc.shelfLabel} sang ${loc.shelfLabel} → Lấy ở ${loc.rackLabel}`;
      } else {
        transitionType = "next_room";
        transitionHint = `Rời ${prevLoc.roomLabel} → Sang ${loc.roomLabel} → Đến ${loc.shelfLabel} → Lấy ở ${loc.rackLabel}`;
      }
    }

    const pickMeta: PickPathEnrichedItem<T> = {
      item,
      stepOrder,
      parsedLocation: loc,
      transitionType,
      transitionHint,
    };

    return {
      ...item,
      _pickPath: pickMeta,
    };
  });

  const routeSummaryText = [
    "Sảnh chính",
    ...orderedItems.map(
      (it) => `${it._pickPath.parsedLocation.roomLabel} (${it._pickPath.parsedLocation.shelfLabel} • ${it._pickPath.parsedLocation.rackLabel})`
    ),
    "Quầy Thủ thư",
  ].join(" → ");

  return {
    orderedItems,
    roomsSequence: roomsSet,
    uniqueShelvesCount: shelvesSet.size,
    routeSummaryText,
  };
}

