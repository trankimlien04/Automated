const db = require('../config/db');

async function reclassifyAndPopulate() {
    console.log('🔄 Bắt đầu chuẩn hóa & phân loại danh mục sách...');

    // 1. Cập nhật thông tin các Thể loại hiện có
    await db.execute(`
        UPDATE categories 
        SET name = 'Văn học',
            description = 'Tác phẩm văn học kinh điển, văn học hiện đại Việt Nam và thế giới, thơ ca, kịch và tản văn'
        WHERE id = 1
    `);

    await db.execute(`
        UPDATE categories 
        SET name = 'Tiểu thuyết',
            description = 'Tiểu thuyết lãng mạn, trinh thám, phiêu lưu, kỳ ảo và truyện dài đương đại'
        WHERE id = 8
    `);

    await db.execute(`
        UPDATE categories 
        SET name = 'Thiếu nhi & Cổ tích',
            description = 'Truyện cổ tích dân gian, ngụ ngôn, thần thoại và sách khám phá cho thiếu nhi'
        WHERE id = 6
    `);

    await db.execute(`
        UPDATE categories 
        SET name = 'Khoa học & Công nghệ',
            description = 'Vũ trụ học, vật lý, sinh học, công nghệ phần mềm, lập trình và Trí tuệ nhân tạo AI'
        WHERE id = 2
    `);

    await db.execute(`
        UPDATE categories 
        SET name = 'Kinh tế & Quản trị',
            description = 'Kinh doanh, tài chính, đầu tư, khởi nghiệp, tiếp thị và kỹ năng lãnh đạo'
        WHERE id = 3
    `);

    await db.execute(`
        UPDATE categories 
        SET name = 'Kỹ năng & Phát triển',
            description = 'Tư duy tích cực, tâm lý học ứng dụng, nghệ thuật giao tiếp và kỹ năng bản thân'
        WHERE id = 4
    `);

    await db.execute(`
        UPDATE categories 
        SET name = 'Lịch sử & Triết học',
            description = 'Lịch sử Việt Nam, văn minh thế giới, danh nhân và triết học nhân sinh'
        WHERE id = 5
    `);

    // 2. Tạo Thể loại "Truyện tranh & Manga" nếu chưa có
    let comicCategoryId;
    const [existingComics] = await db.execute("SELECT id FROM categories WHERE name LIKE '%Truyện tranh%' LIMIT 1");
    if (existingComics.length > 0) {
        comicCategoryId = existingComics[0].id;
        await db.execute(
            "UPDATE categories SET name = 'Truyện tranh & Manga', description = ? WHERE id = ?",
            ['Truyện tranh thiếu nhi, manga Nhật Bản, graphic novel và truyện tranh giáo dục Việt Nam', comicCategoryId]
        );
    } else {
        const [insertCat] = await db.execute(
            "INSERT INTO categories (name, description) VALUES (?, ?)",
            ['Truyện tranh & Manga', 'Truyện tranh thiếu nhi, manga Nhật Bản, graphic novel và truyện tranh giáo dục Việt Nam']
        );
        comicCategoryId = insertCat.insertId;
    }
    console.log(`✅ Thể loại "Truyện tranh & Manga" có ID: ${comicCategoryId}`);

    // 3. Điều chuyển sách từ Thiếu nhi (6) sang Tiểu thuyết (8) cho các tựa truyện tuổi teen / ngôn tình
    const teenRomanceTitles = [
        'Trò Chơi Tình Yêu',
        'Tiểu Thư Kiêu Ngạo Và Thiếu Gia Sát Gái',
        'Này, Chớ Làm Loạn',
        'Thầy Giáo Bá Đạo, Anh Là Của Em',
        'Chuyện Tình Vượt Thời Gian',
        'Vợ!!! Đứng Lại Đó Cho Chồng',
        'Cô Vợ Nhí Đáng Yêu',
        'Bang Chủ Biết Yêu',
        'Cô Vợ Nữ Quái Của Thiếu Bang Chủ Trẻ Con',
        'Tiểu Bảo Bối Băng Giá Của Tôi',
        'Cô Dâu Đi Học',
        'Yêu Là Chuyện Không Hề Dễ',
        'Tôi Không Phải Là Công Chúa',
        'Hoàng Tử Lạnh Lùng Và Cô Nhóc Lanh Chanh',
        'Bạn Trai Tôi Là Gangter – Boss Đại Nhân',
        'Quán Thiên Thần'
    ];
    for (const title of teenRomanceTitles) {
        await db.execute("UPDATE books SET category_id = 8 WHERE title LIKE ? AND category_id = 6", [`%${title}%`]);
    }
    console.log('✅ Đã chuyển các truyện tình cảm tuổi teen sang Thể loại "Tiểu thuyết"');

    // 4. Điều chuyển các tác phẩm văn học từ Tiểu thuyết (8) về Văn học (1)
    const literatureTitles = [
        'Nhật Ký Anne Frank',
        'Những Mùa Hoa Mãi Nở',
        'Mối Tình Đầu',
        'Juliet',
        'Thiếu Nữ Đánh Cờ Vây',
        'Tổ Ấm Nơi Tận Cùng Thế Giới'
    ];
    for (const title of literatureTitles) {
        await db.execute("UPDATE books SET category_id = 1 WHERE title LIKE ? AND category_id = 8", [`%${title}%`]);
    }
    console.log('✅ Đã chuyển các tác phẩm kinh điển về Thể loại "Văn học"');

    // 5. Thêm Tác giả mới nếu chưa có
    async function getOrCreateAuthor(name, bio) {
        const [rows] = await db.execute("SELECT id FROM authors WHERE name = ? LIMIT 1", [name]);
        if (rows.length > 0) return rows[0].id;
        const [res] = await db.execute("INSERT INTO authors (name, bio) VALUES (?, ?)", [name, bio || `Tác giả ${name}`]);
        return res.insertId;
    }

    // 6. Thêm Nhà xuất bản nếu chưa có
    async function getOrCreatePublisher(name, address) {
        const [rows] = await db.execute("SELECT id FROM publishers WHERE name = ? LIMIT 1", [name]);
        if (rows.length > 0) return rows[0].id;
        const [res] = await db.execute("INSERT INTO publishers (name, address) VALUES (?, ?)", [name, address || 'Hà Nội / TP.HCM']);
        return res.insertId;
    }

    const nxbKimDongId = await getOrCreatePublisher('NXB Kim Đồng', '55 Quang Trung, Hai Bà Trưng, Hà Nội');
    const nxbTreId = await getOrCreatePublisher('NXB Trẻ', '161B Lý Chính Thắng, Quận 3, TP.HCM');
    const nxbHoiNhaVanId = await getOrCreatePublisher('NXB Hội Nhà Văn', '65 Nguyễn Du, Hai Bà Trưng, Hà Nội');
    const nxbVanHocId = await getOrCreatePublisher('NXB Văn Học', '18 Nguyễn Trường Tộ, Ba Đình, Hà Nội');

    // 7. Thêm các bộ Truyện tranh & Manga nổi tiếng
    const comicBooks = [
        {
            title: 'Doraemon: Tuyển Tập Tranh Màu - Chú Mèo Máy Đến Từ Tương Lai',
            isbn: '978-604-2-00101-1',
            author: 'Fujiko F. Fujio',
            authorBio: 'Họa sĩ truyện tranh huyền thoại Nhật Bản, cha đẻ của chú mèo máy thông minh Doraemon.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2022,
            pageCount: 196,
            coverImage: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600',
            description: 'Tuyển tập những cuộc phiêu lưu kỳ thú của chú mèo máy Doraemon và nhóm bạn Nobita, Shizuka, Jaian, Suneo với những bảo bối tương lai diệu kỳ.'
        },
        {
            title: 'Thám Tử Lừng Danh Conan - Tập 100',
            isbn: '978-604-2-00102-8',
            author: 'Gosho Aoyama',
            authorBio: 'Họa sĩ truyện tranh trinh thám nổi tiếng Nhật Bản, tác giả bộ truyện Thám tử lừng danh Conan.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2023,
            pageCount: 188,
            coverImage: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600',
            description: 'Dấu mốc lịch sử tập 100 của bộ truyện tranh trinh thám hấp dẫn nhất hành tinh, hé lộ những bí mật nghẹt thở về Tổ chức Áo đen.'
        },
        {
            title: 'Dragon Ball - Bảy Viên Ngọc Rồng (Tập 1)',
            isbn: '978-604-2-00103-5',
            author: 'Akira Toriyama',
            authorBio: 'Tượng đài manga hành động Nhật Bản, người sáng tạo ra thế giới võ thuật Dragon Ball.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2021,
            pageCount: 192,
            coverImage: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600',
            description: 'Hành trình tầm sư học đạo và truy tìm 7 viên ngọc rồng huyền thoại của cậu bé đuôi khỉ Son Goku cùng người bạn Bulma.'
        },
        {
            title: 'One Piece - Đảo Hải Tặc: Khởi Đầu Đại Hải Trình',
            isbn: '978-604-2-00104-2',
            author: 'Eiichiro Oda',
            authorBio: 'Tác giả bộ truyện tranh bán chạy nhất lịch sử thế giới One Piece.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2023,
            pageCount: 208,
            coverImage: 'https://images.unsplash.com/photo-1532012164546-f432f2e3ddb5?w=600',
            description: 'Câu chuyện về ước mơ trở thành Vua Hải Tặc của chàng trai mũ rơm Monkey D. Luffy cùng những đồng đội vào sinh ra tử.'
        },
        {
            title: 'Thần Đồng Đất Việt: Pháp Đình Tỉ Thí',
            isbn: '978-604-1-00105-9',
            author: 'Lê Linh',
            authorBio: 'Họa sĩ truyện tranh danh tiếng Việt Nam, tác giả của bộ truyện thuần Việt Thần Đồng Đất Việt.',
            publisherId: nxbTreId,
            categoryId: comicCategoryId,
            publishedYear: 2020,
            pageCount: 104,
            coverImage: 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=600',
            description: 'Bộ tứ Tí, Sửu, Dần, Mẹo với những màn so tài trí tuệ dân gian hóm hỉnh, tôn vinh tinh hoa lịch sử và văn hóa đất Việt.'
        },
        {
            title: 'Trạng Quỳnh & Trạng Lợn (Tranh Truyện Dân Gian)',
            isbn: '978-604-2-00106-6',
            author: 'Nguyễn Bích',
            authorBio: 'Họa sĩ truyện tranh và minh họa dân gian gạo cội.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2021,
            pageCount: 120,
            coverImage: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=600',
            description: 'Tiếng cười trào phúng, trí tuệ dân gian sắc sảo của Trạng Quỳnh đả kích bọn tham quan lại nhũng nhiễu thời phong kiến.'
        },
        {
            title: 'Dế Mèn Phiêu Lưu Ký (Ấn Bản Tranh Đồ Họa)',
            isbn: '978-604-2-00107-3',
            author: 'Tô Hoài',
            authorBio: 'Cây đại thụ của nền văn học thiếu nhi Việt Nam.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2022,
            pageCount: 156,
            coverImage: 'https://images.unsplash.com/photo-1476275466078-4007374efbbe?w=600',
            description: 'Kiệt tác Dế Mèn được tái hiện dưới nét vẽ đồ họa sống động của họa sĩ Tạ Huy Long, đưa bạn đọc phiêu lưu cùng chú Dế Mèn kiêu dũng.'
        },
        {
            title: 'Shin - Cậu Bé Bút Chì: Những Ngày Hè Vui Nhộn',
            isbn: '978-604-2-00108-0',
            author: 'Yoshito Usui',
            authorBio: 'Họa sĩ truyện tranh hài hước Nhật Bản.',
            publisherId: nxbKimDongId,
            categoryId: comicCategoryId,
            publishedYear: 2021,
            pageCount: 128,
            coverImage: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=600',
            description: 'Những mẩu chuyện đời thường ngộ nghĩnh, hài hước và hồn nhiên của cậu bé 5 tuổi Shinnosuke cùng gia đình Nohara.'
        }
    ];

    // 8. Thêm các tác phẩm Văn học kinh điển nổi tiếng
    const literatureBooks = [
        {
            title: 'Số Đỏ',
            isbn: '978-604-9-00201-5',
            author: 'Vũ Trọng Phụng',
            authorBio: 'Ông vua phóng sự đất Bắc, bậc thầy văn học hiện thực phê phán Việt Nam thế kỷ 20.',
            publisherId: nxbVanHocId,
            categoryId: 1, // Văn học
            publishedYear: 2020,
            pageCount: 260,
            coverImage: 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=600',
            description: 'Kiệt tác trào phúng đỉnh cao của văn học Việt Nam về hành trình đổi đời đầy bi hài của Xuân Tóc Đỏ trong xã hội âu hóa nhố nhăng.'
        },
        {
            title: 'Tắt Đèn',
            isbn: '978-604-9-00202-2',
            author: 'Ngô Tất Tố',
            authorBio: 'Nhà văn, nhà báo, nhà nghiên cứu văn hóa Việt Nam xuất sắc.',
            publisherId: nxbVanHocId,
            categoryId: 1, // Văn học
            publishedYear: 2019,
            pageCount: 216,
            coverImage: 'https://images.unsplash.com/photo-1463320726281-696a485928c7?w=600',
            description: 'Bức tranh hiện thực chân xác về số phận cùng khổ và sức sống quật khởi của người nông dân Việt Nam trước Cách mạng, tiêu biểu là chị Dậu.'
        },
        {
            title: 'Chí Phèo & Tuyển Tập Truyện Ngắn Nam Cao',
            isbn: '978-604-9-00203-9',
            author: 'Nam Cao',
            authorBio: 'Nhà văn hiện thực xuất sắc với ngòi bút phân tích tâm lý bậc thầy của văn học Việt Nam.',
            publisherId: nxbHoiNhaVanId,
            categoryId: 1, // Văn học
            publishedYear: 2021,
            pageCount: 320,
            coverImage: 'https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=600',
            description: 'Tuyển tập những kiệt tác truyện ngắn bất hủ của Nam Cao: Chí Phèo, Lão Hạc, Đời Thừa, Giăng Sáng, Đôi Mắt.'
        },
        {
            title: 'Những Người Khốn Khổ (Tuyển Tập 2 Tập)',
            isbn: '978-604-9-00204-6',
            author: 'Victor Hugo',
            authorBio: 'Đại văn hào người Pháp, một trong những nhà văn vĩ đại nhất của văn học lãng mạn thế giới.',
            publisherId: nxbVanHocId,
            categoryId: 1, // Văn học
            publishedYear: 2022,
            pageCount: 680,
            coverImage: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=600',
            description: 'Bản hùng ca vĩ đại về tình thương yêu con người, lòng nhân ái và sự cứu rỗi linh hồn của Jean Valjean giữa Paris thế kỷ 19.'
        },
        {
            title: 'Ông Già Và Biển Cả',
            isbn: '978-604-9-00205-3',
            author: 'Ernest Hemingway',
            authorBio: 'Nhà văn Mỹ đoạt giải Nobel Văn học năm 1954 với nguyên lý tảng băng trôi trứ danh.',
            publisherId: nxbHoiNhaVanId,
            categoryId: 1, // Văn học
            publishedYear: 2020,
            pageCount: 148,
            coverImage: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600',
            description: 'Cuộc chiến bất khuất giữa ông lão đánh cá Santiago và con cá kiếm khổng lồ trên dòng Hải Lưu, khẳng định ý chí kiên cường của con người.'
        },
        {
            title: 'Hoàng Tử Bé',
            isbn: '978-604-2-00206-0',
            author: 'Antoine de Saint-Exupéry',
            authorBio: 'Nhà văn kiêm phi công người Pháp, tác giả cuốn sách triết lý nhân văn cảm động nhất thế kỷ 20.',
            publisherId: nxbKimDongId,
            categoryId: 1, // Văn học
            publishedYear: 2023,
            pageCount: 120,
            coverImage: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=600',
            description: 'Hành trình rời tiểu tinh cầu B612 đi tìm ý nghĩa của tình bạn, tình yêu và trách nhiệm đối với bông hoa hồng duy nhất.'
        },
        {
            title: 'Trăm Năm Cô Đơn',
            isbn: '978-604-9-00207-7',
            author: 'Gabriel García Márquez',
            authorBio: 'Đại văn hào Colombia, cha đẻ của chủ nghĩa hiện thực huyền ảo, giải Nobel Văn học 1982.',
            publisherId: nxbVanHocId,
            categoryId: 1, // Văn học
            publishedYear: 2021,
            pageCount: 496,
            coverImage: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600',
            description: 'Sử thi kỳ ảo về bảy thế hệ gia tộc Buendía tại ngôi làng Macondo huyền thoại, kiệt tác đỉnh cao của văn học Mỹ Latinh.'
        }
    ];

    const allNewBooks = [...comicBooks, ...literatureBooks];

    for (const b of allNewBooks) {
        const [existing] = await db.execute("SELECT id FROM books WHERE isbn = ? OR title = ? LIMIT 1", [b.isbn, b.title]);
        if (existing.length === 0) {
            const authorId = await getOrCreateAuthor(b.author, b.authorBio);
            const shelfLocation = b.categoryId === comicCategoryId
                ? 'Phòng 01 - Kệ 04 - Ngăn 01'
                : 'Phòng 02 - Kệ 01 - Ngăn 03';

            const [insertRes] = await db.execute(
                `INSERT INTO books (
                    title, isbn, author_id, publisher_id, category_id, 
                    published_year, cover_image, description, 
                    total_copies, available_copies, status, location
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
                [
                    b.title, b.isbn, authorId, b.publisherId, b.categoryId,
                    b.publishedYear, b.coverImage, b.description,
                    4, 4, shelfLocation
                ]
            );
            const bookId = insertRes.insertId;

            // Tạo 4 bản sao vật lý trên kệ có mã QR
            for (let i = 1; i <= 4; i++) {
                const qrCode = `QR-BK-${bookId}-${i}`;
                await db.execute(
                    `INSERT INTO book_copies (book_id, qr_code, status)
                     VALUES (?, ?, 'available')`,
                    [bookId, qrCode]
                );
            }
            console.log(`  + Đã thêm sách mới: "${b.title}" (${b.categoryId === comicCategoryId ? 'Truyện tranh' : 'Văn học'})`);
        }
    }

    console.log('🎉 Hoàn tất phân loại thể loại và bổ sung sách chuẩn mực!');
}

reclassifyAndPopulate()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Lỗi khi phân loại sách:', err);
        process.exit(1);
    });
