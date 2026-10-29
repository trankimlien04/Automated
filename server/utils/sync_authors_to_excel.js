const path = require('path');
const XLSX = require('../../client/node_modules/xlsx');
const db = require('../config/db');

async function syncExcel() {
    try {
        console.log('📖 Lấy danh sách toàn bộ sách và tác giả từ cơ sở dữ liệu...');
        const [books] = await db.execute(`
            SELECT b.title, a.name as author_name
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
        `);

        const titleToAuthor = new Map();
        for (const b of books) {
            if (b.title && b.author_name) {
                titleToAuthor.set(b.title.trim().toLowerCase(), b.author_name.trim());
            }
        }

        const excelFiles = [
            path.resolve(__dirname, '../../Kho_Sach_500_SachHayOnline.xlsx'),
            path.resolve(__dirname, '../../Kho_Sach_500_ThuVienSach.xlsx')
        ];

        for (const filePath of excelFiles) {
            console.log(`\n🔄 Đang xử lý file: ${path.basename(filePath)}...`);
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet);

            let updatedCount = 0;
            for (const row of data) {
                const title = (row['Tên sách'] || '').trim().toLowerCase();
                if (titleToAuthor.has(title)) {
                    const realAuthor = titleToAuthor.get(title);
                    if (row['Tác giả'] !== realAuthor) {
                        row['Tác giả'] = realAuthor;
                        updatedCount++;
                    }
                }
            }

            const newSheet = XLSX.utils.json_to_sheet(data);
            workbook.Sheets[sheetName] = newSheet;
            XLSX.writeFile(workbook, filePath);
            console.log(`✅ Đã cập nhật ${updatedCount} dòng trong ${path.basename(filePath)}`);
        }

        console.log('\n🎉 Hoàn thành đồng bộ toàn bộ file Excel kho sách!');
    } catch (e) {
        console.error('Lỗi khi đồng bộ file Excel:', e);
    } finally {
        process.exit();
    }
}

syncExcel();
