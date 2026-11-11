/**
 * Smart Fuzzy & Semantic Search Engine for Athenaeum Smart Library
 * - Supports 1-character & multi-word Vietnamese accent-insensitive search
 * - Supports Vietnamese phonetic & keyboard typo tolerance (e.g., "mac biet" -> "Mắt Biếc", "clen code" -> "Clean Code")
 * - Supports natural language semantic queries when no direct title matches
 */

export interface SmartSearchBookInput {
  id: number;
  title: string;
  author_name?: string;
  category_name?: string;
  publisher_name?: string;
  isbn?: string;
  description?: string;
  location?: string;
  [key: string]: any;
}

export type MatchType = "exact" | "accent_insensitive" | "fuzzy_typo" | "semantic" | "description";

export interface SmartMatchMeta {
  score: number;
  matchType: MatchType;
}

export interface SmartSearchOutput<T> {
  items: Array<T & { _smartMatch?: SmartMatchMeta }>;
}

/**
 * 1. Normalize Vietnamese string (remove accents, convert đ -> d, lowercase, collapse spaces)
 */
export function normalizeVi(str?: string | null): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 2. Normalize common Vietnamese phonetic confusions per word
 * e.g. "mac" <-> "mat", "biet" <-> "biec", "ng" <-> "n", "tr" <-> "ch", "s" <-> "x", "y" <-> "i"
 */
export function phoneticViWord(word: string): string {
  if (!word || word.length < 2) return word;
  let w = word;
  // Normalize initial consonants
  w = w.replace(/^(tr)/, "ch");
  w = w.replace(/^(s)/, "x");
  w = w.replace(/^(gi|r)/, "d");
  // Normalize vowel y -> i
  w = w.replace(/y/g, "i");
  // Normalize ending consonants (c <-> t, ch <-> t, ng <-> n, nh <-> n)
  w = w.replace(/(ch|c)$/, "t");
  w = w.replace(/(ng|nh)$/, "n");
  return w;
}

export function phoneticViPhrase(normStr: string): string {
  if (!normStr) return "";
  return normStr
    .split(" ")
    .filter(Boolean)
    .map(phoneticViWord)
    .join(" ");
}

/**
 * 3. Damerau-Levenshtein Distance
 */
export function damerauLevenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const dp: number[][] = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
  for (let i = 0; i <= lenA; i++) dp[i][0] = i;
  for (let j = 0; j <= lenB; j++) dp[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[lenA][lenB];
}

/**
 * Check if two normalized words match under typo/phonetic tolerance
 */
function isWordTypoMatch(qWord: string, tWord: string): { matched: boolean; sim: number } {
  if (!qWord || !tWord) return { matched: false, sim: 0 };
  if (qWord === tWord) return { matched: true, sim: 1.0 };

  // Prefix match for last word being typed (e.g. "mat bi" -> "mat biec")
  if (tWord.startsWith(qWord) && qWord.length >= 2) {
    return { matched: true, sim: 0.92 };
  }

  // Vietnamese phonetic equivalence (e.g. "mac" == "mat", "biet" == "biec")
  if (qWord.length >= 2 && tWord.length >= 2 && phoneticViWord(qWord) === phoneticViWord(tWord)) {
    return { matched: true, sim: 0.94 };
  }

  // Keyboard edit distance tolerance (must share first character to avoid random false positives)
  if (qWord.length >= 3 && tWord.length >= 3 && qWord[0] === tWord[0]) {
    const dist = damerauLevenshtein(qWord, tWord);
    const maxLen = Math.max(qWord.length, tWord.length);
    if (dist <= 1 && maxLen >= 3) {
      return { matched: true, sim: 0.86 };
    }
    if (dist <= 2 && maxLen >= 6) {
      return { matched: true, sim: 0.78 };
    }
  }

  return { matched: false, sim: 0 };
}

/**
 * Check if queryTokens match any contiguous window of words in targetWords
 * e.g. ["mac", "biet"] against ["mat", "biec"] -> true!
 * e.g. ["mac", "biet"] against ["vu", "bi", "an", "cau", "vong", "bien", "mat"] -> false!
 */
function matchContiguousWindowFuzzy(queryTokens: string[], targetWords: string[]): number {
  const k = queryTokens.length;
  if (k === 0 || targetWords.length < k) return 0;

  let bestWindowSim = 0;
  for (let start = 0; start <= targetWords.length - k; start++) {
    let allMatched = true;
    let sumSim = 0;
    for (let i = 0; i < k; i++) {
      const res = isWordTypoMatch(queryTokens[i], targetWords[start + i]);
      if (!res.matched) {
        allMatched = false;
        break;
      }
      sumSim += res.sim;
    }
    if (allMatched) {
      const avgSim = sumSim / k;
      // Bonus if match starts at the beginning of the title
      const posBonus = start === 0 ? 0.04 : 0;
      bestWindowSim = Math.max(bestWindowSim, Math.min(0.98, avgSim + posBonus));
    }
  }
  return bestWindowSim;
}

const VIETNAMESE_QUERY_STOPWORDS = new Set([
  "tim", "sach", "cuon", "quyen", "tac", "pham", "ve", "cho", "toi", "minh",
  "muon", "doc", "hoc", "day", "giup", "cach", "lam", "sao", "de", "nhung",
  "cac", "mot", "co", "khong", "nao", "hay", "nhat", "tot", "can"
]);

export interface SemanticConceptCluster {
  id: string;
  triggers: string[];
  expansions: string[];
}

export const SEMANTIC_CONCEPTS: SemanticConceptCluster[] = [
  {
    id: "tech_coding",
    triggers: [
      "lap trinh", "code", "coding", "web", "phan mem", "thuat toan", "cntt",
      "cong nghe", "may tinh", "fullstack", "frontend", "backend", "react",
      "nodejs", "javascript", "python", "java", "tri tue nhan tao", "clean code", "viet ma"
    ],
    expansions: [
      "lap trinh", "code", "ma sach", "clean code", "node", "react", "thuc chien",
      "khoa hoc", "cong nghe", "thuat toan", "phan mem", "may tinh", "du lieu"
    ]
  },
  {
    id: "habits_selfhelp",
    triggers: [
      "thoi quen", "ky luat", "phat trien ban than", "ky nang", "atomic",
      "habits", "muc tieu", "tap trung", "nang suat", "quan ly thoi gian",
      "hieu qua", "sap xep thoi gian", "lam viec hieu qua", "tri hoan", "ren luyen"
    ],
    expansions: [
      "thoi quen", "nguyen tu", "atomic", "habits", "ky nang", "phat trien",
      "buong bo", "giao tiep", "dinh cao", "thanh cong", "nang doan", "kim cuong"
    ]
  },
  {
    id: "communication_persuasion",
    triggers: [
      "giao tiep", "ung xu", "thuyet phuc", "dam phan", "nhan tam", "dac nhan tam",
      "noi chuyen", "ket ban", "lanh dao", "hung bien", "doi nhan xu the", "thu phuc"
    ],
    expansions: [
      "giao tiep", "dinh cao", "nghe thuat", "dac nhan tam", "ung xu", "thu phuc",
      "long nguoi", "ky nang", "phat trien"
    ]
  },
  {
    id: "healing_mindfulness",
    triggers: [
      "chua lanh", "tam hon", "buong bo", "binh yen", "hanh phuc", "tam ly",
      "cam xuc", "ap luc", "stress", "met moi", "lo au", "tram cam", "an nhien",
      "song cham", "gian di", "binh di", "tinh tam", "thien"
    ],
    expansions: [
      "buong bo", "binh di", "vo gia", "bai hoc", "tam hon", "nha gia kim",
      "rung na uy", "chua lanh", "cam xuc", "hanh phuc", "ky nang"
    ]
  },
  {
    id: "youth_romance",
    triggers: [
      "tinh cam", "tinh yeu", "hoc tro", "thanh xuan", "tuoi tre", "tuoi tho",
      "thieu nhi", "lang man", "ky niem", "truong lop", "moi tinh dau"
    ],
    expansions: [
      "mat biec", "kinh van hoa", "nguyen nhat anh", "thieu nhi", "tuoi tre",
      "rung na uy", "tieu thuyet", "van hoc", "tinh yeu", "hoc tro"
    ]
  },
  {
    id: "science_cosmos",
    triggers: [
      "vu tru", "luoc su thoi gian", "khong gian", "vat ly", "thien van", "ho den",
      "big bang", "stephen hawking", "kham pha vu tru"
    ],
    expansions: [
      "luoc su thoi gian", "vu tru", "khoa hoc", "cong nghe", "thoi gian",
      "hawking", "vat ly", "khong gian"
    ]
  }
];

/**
 * Main Smart Search function for a list of books
 */
export function runSmartBookSearch<T extends SmartSearchBookInput>(
  books: T[],
  rawQuery: string
): SmartSearchOutput<T> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { items: books };
  }

  const lowerRaw = trimmed.toLowerCase();
  const normQuery = normalizeVi(trimmed);
  if (!normQuery) {
    return { items: books };
  }

  const queryTokens = normQuery.split(" ").filter(Boolean);
  const coreTokens = queryTokens.filter((t) => !VIETNAMESE_QUERY_STOPWORDS.has(t));
  const effectiveTokens = coreTokens.length > 0 ? coreTokens : queryTokens;

  // ============================================================================
  // PASS 1: DIRECT MATCH (Có dấu hoặc Không dấu, từ 1 chữ cái trở lên)
  // Nếu có bất kỳ đầu sách nào khớp trực tiếp chữ người dùng gõ -> Chỉ hiện các sách đó!
  // ============================================================================
  const directMatches: Array<{ book: T; score: number; matchType: MatchType }> = [];

  for (const book of books) {
    const rawTitle = (book.title || "").toLowerCase();
    const rawAuthor = (book.author_name || "").toLowerCase();
    const rawCategory = (book.category_name || "").toLowerCase();
    const rawIsbn = (book.isbn || "").toLowerCase();
    const rawLoc = (book.location || "").toLowerCase();

    const normTitle = normalizeVi(book.title);
    const normAuthor = normalizeVi(book.author_name);
    const normCategory = normalizeVi(book.category_name);
    const normLoc = normalizeVi(book.location);

    const titleWords = normTitle.split(" ").filter(Boolean);
    const authorWords = normAuthor.split(" ").filter(Boolean);

    // 1a. Khớp chính xác chuỗi có dấu trong Tên sách
    if (rawTitle.includes(lowerRaw)) {
      const starts = rawTitle.startsWith(lowerRaw) || titleWords.some((w) => w === normQuery || w.startsWith(normQuery));
      directMatches.push({
        book,
        score: starts ? 100 : 97,
        matchType: "exact"
      });
      continue;
    }

    // 1b. Khớp chuỗi không dấu liên tiếp trong Tên sách (VD: gõ "m", "mat", "mat biec", "nha gia kim")
    if (normTitle.includes(normQuery)) {
      const starts = normTitle.startsWith(normQuery) || titleWords.some((w) => w.startsWith(normQuery));
      directMatches.push({
        book,
        score: starts ? 96 : 93,
        matchType: "accent_insensitive"
      });
      continue;
    }

    // 1c. Tất cả các từ người dùng gõ đều xuất hiện (hoặc là tiền tố) trong Tên sách theo đúng thứ tự
    if (queryTokens.length > 1 && titleWords.length >= queryTokens.length) {
      let tIdx = 0;
      let matchedInOrder = 0;
      for (const qTk of queryTokens) {
        while (tIdx < titleWords.length) {
          if (titleWords[tIdx] === qTk || (qTk.length >= 2 && titleWords[tIdx].startsWith(qTk))) {
            matchedInOrder++;
            tIdx++;
            break;
          }
          tIdx++;
        }
      }
      if (matchedInOrder === queryTokens.length) {
        directMatches.push({
          book,
          score: 91,
          matchType: "accent_insensitive"
        });
        continue;
      }
    }

    // 1d. Khớp trong Tác giả, Thể loại, ISBN hoặc Vị trí kệ (có dấu hoặc không dấu)
    if (
      rawAuthor.includes(lowerRaw) ||
      normAuthor.includes(normQuery) ||
      rawIsbn.includes(lowerRaw) ||
      rawCategory.includes(lowerRaw) ||
      normCategory.includes(normQuery) ||
      rawLoc.includes(lowerRaw) ||
      normLoc.includes(normQuery) ||
      (queryTokens.length === 1 && authorWords.some((w) => w.startsWith(normQuery)))
    ) {
      directMatches.push({
        book,
        score: normAuthor.includes(normQuery) ? 88 : 84,
        matchType: "accent_insensitive"
      });
      continue;
    }
  }

  // Nếu có sách khớp trực tiếp -> Trả về ngay danh sách đó (không trộn kết quả nhiễu từ fuzzy)
  if (directMatches.length > 0) {
    directMatches.sort((a, b) => b.score - a.score);
    return {
      items: directMatches.map((m) => ({
        ...m.book,
        _smartMatch: { score: m.score, matchType: m.matchType }
      }))
    };
  }

  // ============================================================================
  // PASS 2: BẮT LỖI CHÍNH TẢ & ÂM VẦN TIẾNG VIỆT (VD: "mac biet" -> "Mắt Biếc", "clen code" -> "Clean Code")
  // Chỉ kích hoạt khi Pass 1 không tìm thấy kết quả trực tiếp
  // ============================================================================
  const fuzzyMatches: Array<{ book: T; score: number }> = [];
  const phoneticQuery = phoneticViPhrase(normQuery);

  for (const book of books) {
    const normTitle = normalizeVi(book.title);
    const normAuthor = normalizeVi(book.author_name);
    const titleWords = normTitle.split(" ").filter(Boolean);
    const authorWords = normAuthor.split(" ").filter(Boolean);

    // 2a. Khớp âm vần tiếng Việt liên tiếp (VD: "mac biet" -> "mat biet" === phonetic("Mắt Biếc"))
    const phoneticTitle = phoneticViPhrase(normTitle);
    if (phoneticQuery.length >= 2 && phoneticTitle.includes(phoneticQuery)) {
      fuzzyMatches.push({ book, score: 95 });
      continue;
    }

    // 2b. Khớp cửa sổ từ liên tiếp (Sliding Window) trên Tên sách hoặc Tác giả
    const titleWinSim = matchContiguousWindowFuzzy(effectiveTokens, titleWords);
    const authorWinSim = matchContiguousWindowFuzzy(effectiveTokens, authorWords);
    const bestWinSim = Math.max(titleWinSim, authorWinSim * 0.95);

    if (bestWinSim >= 0.78) {
      fuzzyMatches.push({
        book,
        score: Math.round(bestWinSim * 92)
      });
    }
  }

  if (fuzzyMatches.length > 0) {
    fuzzyMatches.sort((a, b) => b.score - a.score);
    return {
      items: fuzzyMatches.map((m) => ({
        ...m.book,
        _smartMatch: { score: m.score, matchType: "fuzzy_typo" }
      }))
    };
  }

  // ============================================================================
  // PASS 3: TÌM KIẾM NGỮ NGHĨA THEO NHU CẦU / MÔ TẢ (VD: "sách chữa lành tâm hồn")
  // ============================================================================
  const activeConcepts = SEMANTIC_CONCEPTS.filter((cluster) =>
    cluster.triggers.some((t) => normQuery.includes(t))
  );

  const semanticMatches: Array<{ book: T; score: number }> = [];

  for (const book of books) {
    const normTitle = normalizeVi(book.title);
    const normAuthor = normalizeVi(book.author_name);
    const normCategory = normalizeVi(book.category_name);
    const normDesc = normalizeVi(book.description);
    const normCombined = `${normTitle} ${normAuthor} ${normCategory} ${normDesc}`;

    // Khớp các từ khóa chính trong phần mô tả tóm tắt
    if (
      effectiveTokens.length >= 2 &&
      effectiveTokens.every((tk) => normCombined.includes(tk))
    ) {
      semanticMatches.push({ book, score: 82 });
      continue;
    }

    if (activeConcepts.length > 0) {
      let hits = 0;
      for (const concept of activeConcepts) {
        for (const exp of concept.expansions) {
          if (normTitle.includes(exp)) hits += 3;
          else if (normCategory.includes(exp)) hits += 2;
          else if (normDesc.includes(exp)) hits += 2;
          else if (normAuthor.includes(exp)) hits += 2;
        }
      }
      if (hits >= 2) {
        semanticMatches.push({
          book,
          score: Math.min(80, 60 + hits * 4)
        });
      }
    }
  }

  semanticMatches.sort((a, b) => b.score - a.score);
  return {
    items: semanticMatches.map((m) => ({
      ...m.book,
      _smartMatch: { score: m.score, matchType: "semantic" }
    }))
  };
}
