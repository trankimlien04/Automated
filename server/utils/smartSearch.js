/**
 * Backend Smart Fuzzy & Semantic Search Engine for Athenaeum Global Search
 * - Pass 1: Direct substring/word match (with or without Vietnamese accents, from 1 character up)
 * - Pass 2: Vietnamese phonetic & contiguous-window typo tolerance (e.g., "mac biet" -> "Mắt Biếc", "clen code" -> "Clean Code")
 * - Pass 3: Semantic topic & description fallback
 */

function normalizeVi(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function phoneticViWord(word) {
    if (!word || word.length < 2) return word;
    let w = word;
    w = w.replace(/^(tr)/, 'ch');
    w = w.replace(/^(s)/, 'x');
    w = w.replace(/^(gi|r)/, 'd');
    w = w.replace(/y/g, 'i');
    w = w.replace(/(ch|c)$/, 't');
    w = w.replace(/(ng|nh)$/, 'n');
    return w;
}

function phoneticViPhrase(normStr) {
    if (!normStr) return '';
    return normStr
        .split(' ')
        .filter(Boolean)
        .map(phoneticViWord)
        .join(' ');
}

function damerauLevenshtein(a, b) {
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) return lenB;
    if (lenB === 0) return lenA;

    const dp = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
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

function isWordTypoMatch(qWord, tWord) {
    if (!qWord || !tWord) return { matched: false, sim: 0 };
    if (qWord === tWord) return { matched: true, sim: 1.0 };

    if (tWord.startsWith(qWord) && qWord.length >= 2) {
        return { matched: true, sim: 0.92 };
    }

    if (qWord.length >= 2 && tWord.length >= 2 && phoneticViWord(qWord) === phoneticViWord(tWord)) {
        return { matched: true, sim: 0.94 };
    }

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

function matchContiguousWindowFuzzy(queryTokens, targetWords) {
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
            const posBonus = start === 0 ? 0.04 : 0;
            bestWindowSim = Math.max(bestWindowSim, Math.min(0.98, avgSim + posBonus));
        }
    }
    return bestWindowSim;
}

const VIETNAMESE_QUERY_STOPWORDS = new Set([
    'tim', 'sach', 'cuon', 'quyen', 'tac', 'pham', 've', 'cho', 'toi', 'minh',
    'muon', 'doc', 'hoc', 'day', 'giup', 'cach', 'lam', 'sao', 'de', 'nhung',
    'cac', 'mot', 'co', 'khong', 'nao', 'hay', 'nhat', 'tot', 'can'
]);

const SEMANTIC_CONCEPTS = [
    {
        id: 'tech_coding',
        triggers: [
            'lap trinh', 'code', 'coding', 'web', 'phan mem', 'thuat toan', 'cntt',
            'cong nghe', 'may tinh', 'fullstack', 'frontend', 'backend', 'react',
            'nodejs', 'javascript', 'python', 'java', 'tri tue nhan tao', 'clean code', 'viet ma'
        ],
        expansions: [
            'lap trinh', 'code', 'ma sach', 'clean code', 'node', 'react', 'thuc chien',
            'khoa hoc', 'cong nghe', 'thuat toan', 'phan mem', 'may tinh', 'du lieu'
        ]
    },
    {
        id: 'habits_selfhelp',
        triggers: [
            'thoi quen', 'ky luat', 'phat trien ban than', 'ky nang', 'atomic',
            'habits', 'muc tieu', 'tap trung', 'nang suat', 'quan ly thoi gian',
            'hieu qua', 'sap xep thoi gian', 'lam viec hieu qua', 'tri hoan', 'ren luyen'
        ],
        expansions: [
            'thoi quen', 'nguyen tu', 'atomic', 'habits', 'ky nang', 'phat trien',
            'buong bo', 'giao tiep', 'dinh cao', 'thanh cong', 'nang doan', 'kim cuong'
        ]
    },
    {
        id: 'communication_persuasion',
        triggers: [
            'giao tiep', 'ung xu', 'thuyet phuc', 'dam phan', 'nhan tam', 'dac nhan tam',
            'noi chuyen', 'ket ban', 'lanh dao', 'hung bien', 'doi nhan xu the', 'thu phuc'
        ],
        expansions: [
            'giao tiep', 'dinh cao', 'nghe thuat', 'dac nhan tam', 'ung xu', 'thu phuc',
            'long nguoi', 'ky nang', 'phat trien'
        ]
    },
    {
        id: 'healing_mindfulness',
        triggers: [
            'chua lanh', 'tam hon', 'buong bo', 'binh yen', 'hanh phuc', 'tam ly',
            'cam xuc', 'ap luc', 'stress', 'met moi', 'lo au', 'tram cam', 'an nhien',
            'song cham', 'gian di', 'binh di', 'tinh tam', 'thien'
        ],
        expansions: [
            'buong bo', 'binh di', 'vo gia', 'bai hoc', 'tam hon', 'nha gia kim',
            'rung na uy', 'chua lanh', 'cam xuc', 'hanh phuc', 'ky nang'
        ]
    },
    {
        id: 'youth_romance',
        triggers: [
            'tinh cam', 'tinh yeu', 'hoc tro', 'thanh xuan', 'tuoi tre', 'tuoi tho',
            'thieu nhi', 'lang man', 'ky niem', 'truong lop', 'moi tinh dau'
        ],
        expansions: [
            'mat biec', 'kinh van hoa', 'nguyen nhat anh', 'thieu nhi', 'tuoi tre',
            'rung na uy', 'tieu thuyet', 'van hoc', 'tinh yeu', 'hoc tro'
        ]
    },
    {
        id: 'science_cosmos',
        triggers: [
            'vu tru', 'luoc su thoi gian', 'khong gian', 'vat ly', 'thien van', 'ho den',
            'big bang', 'stephen hawking', 'kham pha vu tru'
        ],
        expansions: [
            'luoc su thoi gian', 'vu tru', 'khoa hoc', 'cong nghe', 'thoi gian',
            'hawking', 'vat ly', 'khong gian'
        ]
    }
];

function rankBooksSmart(allBooks, rawQuery, limit = 8) {
    const trimmed = (rawQuery || '').trim();
    if (!trimmed) return { books: [], didYouMean: null, detectedConcepts: [] };

    const lowerRaw = trimmed.toLowerCase();
    const normQuery = normalizeVi(trimmed);
    if (!normQuery) return { books: [], didYouMean: null, detectedConcepts: [] };

    const queryTokens = normQuery.split(' ').filter(Boolean);
    const coreTokens = queryTokens.filter((t) => !VIETNAMESE_QUERY_STOPWORDS.has(t));
    const effectiveTokens = coreTokens.length > 0 ? coreTokens : queryTokens;

    // PASS 1: DIRECT MATCH (Có dấu hoặc Không dấu, từ 1 chữ cái trở lên)
    const directMatches = [];

    for (const book of allBooks) {
        const rawTitle = (book.title || '').toLowerCase();
        const rawAuthor = (book.author_name || '').toLowerCase();
        const rawCat = (book.category_name || '').toLowerCase();
        const rawIsbn = (book.isbn || '').toLowerCase();

        const normTitle = normalizeVi(book.title);
        const normAuthor = normalizeVi(book.author_name);
        const normCat = normalizeVi(book.category_name);

        const titleWords = normTitle.split(' ').filter(Boolean);
        const authorWords = normAuthor.split(' ').filter(Boolean);

        if (rawTitle.includes(lowerRaw)) {
            const starts = rawTitle.startsWith(lowerRaw) || titleWords.some((w) => w === normQuery || w.startsWith(normQuery));
            directMatches.push({ ...book, match_score: starts ? 100 : 97, match_type: 'exact' });
            continue;
        }

        if (normTitle.includes(normQuery)) {
            const starts = normTitle.startsWith(normQuery) || titleWords.some((w) => w.startsWith(normQuery));
            directMatches.push({ ...book, match_score: starts ? 96 : 93, match_type: 'accent_insensitive' });
            continue;
        }

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
                directMatches.push({ ...book, match_score: 91, match_type: 'accent_insensitive' });
                continue;
            }
        }

        if (
            rawAuthor.includes(lowerRaw) ||
            normAuthor.includes(normQuery) ||
            rawIsbn.includes(lowerRaw) ||
            rawCat.includes(lowerRaw) ||
            normCat.includes(normQuery) ||
            (queryTokens.length === 1 && authorWords.some((w) => w.startsWith(normQuery)))
        ) {
            directMatches.push({
                ...book,
                match_score: normAuthor.includes(normQuery) ? 88 : 84,
                match_type: 'accent_insensitive'
            });
            continue;
        }
    }

    if (directMatches.length > 0) {
        directMatches.sort((a, b) => b.match_score - a.match_score);
        return {
            books: directMatches.slice(0, limit),
            didYouMean: null,
            detectedConcepts: []
        };
    }

    // PASS 2: PHONETIC & CONTIGUOUS WINDOW FUZZY MATCH (e.g. "mac biet" -> "Mắt Biếc")
    const fuzzyMatches = [];
    const phoneticQuery = phoneticViPhrase(normQuery);

    for (const book of allBooks) {
        const normTitle = normalizeVi(book.title);
        const normAuthor = normalizeVi(book.author_name);
        const titleWords = normTitle.split(' ').filter(Boolean);
        const authorWords = normAuthor.split(' ').filter(Boolean);

        const phoneticTitle = phoneticViPhrase(normTitle);
        if (phoneticQuery.length >= 2 && phoneticTitle.includes(phoneticQuery)) {
            fuzzyMatches.push({ ...book, match_score: 95, match_type: 'fuzzy_typo' });
            continue;
        }

        const titleWinSim = matchContiguousWindowFuzzy(effectiveTokens, titleWords);
        const authorWinSim = matchContiguousWindowFuzzy(effectiveTokens, authorWords);
        const bestWinSim = Math.max(titleWinSim, authorWinSim * 0.95);

        if (bestWinSim >= 0.78) {
            fuzzyMatches.push({
                ...book,
                match_score: Math.round(bestWinSim * 92),
                match_type: 'fuzzy_typo'
            });
        }
    }

    if (fuzzyMatches.length > 0) {
        fuzzyMatches.sort((a, b) => b.match_score - a.match_score);
        return {
            books: fuzzyMatches.slice(0, limit),
            didYouMean: null,
            detectedConcepts: []
        };
    }

    // PASS 3: SEMANTIC INTENT & DESCRIPTION FALLBACK
    const activeConcepts = SEMANTIC_CONCEPTS.filter((cluster) =>
        cluster.triggers.some((t) => normQuery.includes(t))
    );
    const semanticMatches = [];

    for (const book of allBooks) {
        const normTitle = normalizeVi(book.title);
        const normAuthor = normalizeVi(book.author_name);
        const normCat = normalizeVi(book.category_name);
        const normDesc = normalizeVi(book.description);
        const normCombined = `${normTitle} ${normAuthor} ${normCat} ${normDesc}`;

        if (effectiveTokens.length >= 2 && effectiveTokens.every((tk) => normCombined.includes(tk))) {
            semanticMatches.push({ ...book, match_score: 82, match_type: 'description' });
            continue;
        }

        if (activeConcepts.length > 0) {
            let hits = 0;
            for (const concept of activeConcepts) {
                for (const exp of concept.expansions) {
                    if (normTitle.includes(exp)) hits += 3;
                    else if (normCat.includes(exp)) hits += 2;
                    else if (normDesc.includes(exp)) hits += 2;
                    else if (normAuthor.includes(exp)) hits += 2;
                }
            }
            if (hits >= 2) {
                semanticMatches.push({
                    ...book,
                    match_score: Math.min(80, 60 + hits * 4),
                    match_type: 'semantic'
                });
            }
        }
    }

    semanticMatches.sort((a, b) => b.match_score - a.match_score);
    return {
        books: semanticMatches.slice(0, limit),
        didYouMean: null,
        detectedConcepts: []
    };
}

module.exports = { normalizeVi, rankBooksSmart };
