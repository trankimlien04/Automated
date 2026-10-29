const db = require('../config/db');

// Bảng ánh xạ chính xác tác giả thật cho 218 đầu sách
const BOOK_AUTHORS_MAP = {
    16: "Roy Garn",
    17: "Camilo Cruz",
    18: "Adam Khoo",
    19: "Geshe Michael Roach",
    20: "Michael Roach",
    21: "Stephen R. Covey",
    22: "Timothy Ferriss",
    25: "Chin-Ning Chu",
    26: "Christopher McDougall",
    27: "John Gray",
    28: "Mari Tamagawa",
    30: "Sasaki Fumio",
    31: "Anthony Robbins",
    32: "Kishimi Ichiro & Koga Fumitake",
    34: "Xuân Nguyễn",
    39: "Đông Tử",
    42: "Gill Rapley & Tracey Murkett",
    43: "Tsutsumi Chiharu",
    44: "Nguyễn Thị Ninh",
    45: "Vương Vũ",
    46: "Ibuka Masaru",
    47: "Carmine Gallo",
    48: "Leo Babauta",
    49: "Glenn Doman",
    50: "Joseph Murphy",
    51: "Vương Vũ",
    52: "Somsuan Somkantha",
    53: "Franz Metcalf",
    54: "Adele Faber & Elaine Mazlish",
    55: "George Ohsawa",
    56: "Ngô Vĩ Tuệ",
    57: "Ngô Vĩ Tuệ",
    58: "Ngô Vĩ Tuệ",
    59: "Francis Xavier",
    60: "Viktor E. Frankl",
    61: "Sheryl Sandberg",
    62: "Phan Văn Trường",
    63: "Bessel van der Kolk",
    64: "Lê Thẩm Dương",
    66: "Deepak Chopra",
    67: "Nguyễn Duy Cần",
    68: "Brian Tracy",
    69: "Caitlin Doughty",
    70: "Tô Thụy Ngọc",
    71: "Dominic O'Brien",
    72: "Joe Navarro",
    73: "Đạt Lai Lạt Ma & Howard C. Cutler",
    75: "Thích Nhất Hạnh",
    77: "Carl Gustav Jung",
    95: "PGS.TS. Nguyễn Phú Giang",
    147: "Allen Klein",
    196: "Barbara Taylor Bradford",
    198: "Danielle Steel",
    200: "Trish Morey",
    201: "Carole Mortimer",
    204: "Nora Roberts",
    206: "Rachel Gibson",
    208: "Rachel Gibson",
    210: "Sandra Brown",
    211: "Linda Howard",
    212: "Danielle Steel",
    213: "Barbara Cartland",
    214: "Jackie Collins",
    215: "Rachel Gibson",
    216: "Nicholas Sparks",
    218: "Christie Craig",
    220: "Christie Craig",
    221: "Ivan Turgenev",
    224: "Barbara Cartland",
    226: "Danielle Steel",
    228: "Danielle Steel",
    230: "Barbara Cartland",
    231: "Nicholas Sparks",
    232: "Marjorie Kinnan Rawlings",
    233: "Diana Palmer",
    234: "Rachel Gibson",
    235: "Barbara Cartland",
    236: "Lisa Kleypas",
    238: "Emily Giffin",
    240: "Barbara Cartland",
    241: "Elizabeth Thornton",
    244: "Albert Camus",
    246: "Danielle Steel",
    248: "Rachel Gibson",
    250: "David Hewson",
    251: "Thất Tinh Đao",
    252: "Thiết Ngưng",
    253: "Phùng Mộng Long",
    254: "Cao Hành Kiện",
    255: "Vương Dược Văn",
    256: "Chử Nhân Hoạch",
    258: "Trần Thọ",
    260: "Ngô Thừa Ân",
    261: "Vũ Nham",
    262: "Lỗ Tấn",
    264: "Lan Lăng Tiếu Tiếu Sinh",
    266: "Hân Nhiên",
    268: "Tào Tuyết Cần",
    270: "Hùng Đại Mộc",
    271: "Lý Ngư",
    272: "La Quán Trung",
    273: "Khương Nhung",
    274: "Tiêu Đỉnh",
    275: "Phương Bạch Vũ",
    276: "Thi Nại Am",
    278: "M.C. Beaton",
    280: "Nhĩ Nhã",
    281: "Higashino Keigo",
    283: "Higashino Keigo",
    285: "Robert Arthur",
    287: "M.V. Carey",
    289: "Robert Arthur",
    290: "Marc Brandel",
    291: "William Arden",
    292: "Robert Arthur",
    293: "William Arden",
    294: "William Arden",
    295: "William Arden",
    296: "M.V. Carey",
    298: "M.V. Carey",
    300: "William Arden",
    301: "Robert Arthur",
    304: "William Arden",
    305: "William Arden",
    306: "William Arden",
    308: "Anita Shreve",
    310: "Carolyn Keene",
    311: "Carolyn Keene",
    312: "Cornell Woolrich",
    313: "Stephen King",
    314: "Diana Palmer",
    315: "Arthur Conan Doyle",
    319: "Jeffrey Archer",
    323: "Linda Howard",
    378: "Michael F. Roizen & Mehmet C. Oz",
    386: "Don Tapscott & Alex Tapscott",
    402: "Bộ Y Tế Việt Nam",
    416: "Stefan Zweig",
    418: "Roland Barthes",
    419: "John Dewey",
    420: "Peter Senge",
    421: "Bộ Giáo Dục & Đào Tạo",
    423: "Trần Văn Hiến Minh",
    424: "Friedrich Nietzsche",
    425: "Bùi Văn Nam Sơn",
    426: "Ludwig von Mises",
    428: "Lâm Ngữ Đường",
    430: "Trang Tử",
    431: "Phùng Hữu Lan",
    432: "Phùng Hữu Lan",
    433: "Bertrand Russell",
    434: "Nguyễn Hiến Lê",
    435: "Plato",
    436: "G.W.F. Hegel",
    438: "Dominique Folscheid",
    439: "Ludwig Wittgenstein",
    440: "Lưu Trọng Văn",
    441: "Alvin Toffler",
    443: "Trần Thái Đỉnh",
    444: "Phan Bội Châu",
    445: "Werner Heisenberg",
    446: "Nguyễn Văn Trung",
    448: "Friedrich Hayek",
    450: "David McLellan",
    451: "Thái Lễ Húc",
    452: "Tiêu Bình",
    453: "Lê Quý Đôn",
    454: "Tô Hoài",
    455: "Henry Ford",
    456: "Roy Medvedev",
    458: "Nguyễn Hiến Lê",
    459: "Larry Engelmann",
    460: "Bùi Ngọc Tấn",
    461: "Kito Aya",
    463: "Peter Scholl-Latour",
    464: "Sơn Nam",
    465: "Trần Hùng John",
    466: "Howard E. Wasdin & Stephen Templin",
    468: "Báo Tuổi Trẻ (Biên soạn)",
    470: "Tony Buổi Sáng",
    471: "Thích Nhất Hạnh",
    472: "Thích Nhất Hạnh",
    473: "Thích Nhất Hạnh",
    474: "Michael Newton",
    475: "Chu An Sĩ",
    476: "Thần thoại Bắc Âu",
    478: "Truyện dân gian Tây Tạng",
    479: "Sophie de Mullenheim",
    480: "Aleksey Nikolayevich Tolstoy",
    481: "Hermann Hesse",
    482: "Aesop",
    483: "Truyện cổ dân gian",
    484: "Neil Gaiman",
    485: "Truyện dân gian Tây Tạng",
    486: "Truyện cổ Ả Rập",
    488: "Truyện cổ Nhật Bản",
    490: "Edith Hamilton",
    491: "Truyện cổ Di-gan",
    492: "Hans Christian Andersen",
    493: "Truyện cổ tích thế giới",
    494: "Truyện cổ Ả Rập",
    495: "Nguyễn Đổng Chi",
    496: "Thần thoại Hy Lạp",
    498: "Cố Mạn",
    499: "Nhược Thủy",
    500: "Quỳnh Dao",
    501: "Cố Mạn",
    503: "Đồng Hoa",
    504: "Băng Lăng",
    505: "Hạ Nhiên",
    506: "Mộng Nam Thần",
    508: "Tuyết Nhi",
    510: "Cố Tây Tước",
    511: "Cố Mạn",
    512: "Tiểu Thất",
    513: "Mị Nữ Tiêu Dao",
    514: "Cố Mạn",
    515: "Frances Hodgson Burnett"
};

async function updateRealAuthors() {
    console.log('🚀 Bắt đầu quá trình cập nhật tác giả thật cho kho sách...');
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // 1. Tải danh sách tác giả hiện có để tra cứu
        const [existingAuthors] = await conn.execute('SELECT id, name FROM authors');
        const authorMap = new Map();
        for (const a of existingAuthors) {
            authorMap.set(a.name.toLowerCase().trim(), a.id);
        }

        let updatedBooksCount = 0;
        let newAuthorsCreated = 0;

        for (const [bookIdStr, realAuthorName] of Object.entries(BOOK_AUTHORS_MAP)) {
            const bookId = parseInt(bookIdStr, 10);
            const authorKey = realAuthorName.toLowerCase().trim();

            let authorId = null;
            if (authorMap.has(authorKey)) {
                authorId = authorMap.get(authorKey);
            } else {
                // Tạo mới tác giả
                const [result] = await conn.execute(
                    'INSERT INTO authors (name, bio) VALUES (?, ?)',
                    [realAuthorName, `Tác giả nổi tiếng của tác phẩm trong kho sách thư viện.`]
                );
                authorId = result.insertId;
                authorMap.set(authorKey, authorId);
                newAuthorsCreated++;
            }

            // Cập nhật author_id cho cuốn sách
            await conn.execute(
                'UPDATE books SET author_id = ? WHERE id = ?',
                [authorId, bookId]
            );
            updatedBooksCount++;
        }

        await conn.commit();
        console.log(`✅ Hoàn thành thành công!`);
        console.log(`- Đã cập nhật tác giả cho: ${updatedBooksCount} cuốn sách.`);
        console.log(`- Đã thêm mới: ${newAuthorsCreated} tác giả thật vào danh mục tác giả.`);

    } catch (error) {
        await conn.rollback();
        console.error('❌ Lỗi khi cập nhật:', error);
    } finally {
        conn.release();
        process.exit();
    }
}

updateRealAuthors();
