const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVi, rankBooksSmart } = require('../utils/smartSearch');

const SAMPLE_BOOKS = [
    {
        id: 1,
        title: 'Mắt Biếc',
        author_name: 'Nguyễn Nhật Ánh',
        category_name: 'Văn học Việt Nam',
        description: 'Câu chuyện tuổi học trò và tình yêu trong sáng tại làng Đo Đo.',
    },
    {
        id: 2,
        title: 'Clean Code',
        author_name: 'Robert C. Martin',
        category_name: 'Công nghệ thông tin',
        description: 'Hướng dẫn viết mã nguồn sạch, tái cấu trúc và kiểm thử phần mềm.',
    },
    {
        id: 3,
        title: 'Đắc Nhân Tâm',
        author_name: 'Dale Carnegie',
        category_name: 'Kỹ năng sống',
        description: 'Nghệ thuật thu phục lòng người và giao tiếp hiệu quả.',
    },
];

test('normalizeVi strips Vietnamese accents, converts đ to d, and collapses whitespace', () => {
    assert.equal(normalizeVi('  Mắt Biếc — Nguyễn Nhật Ánh  '), 'mat biec nguyen nhat anh');
    assert.equal(normalizeVi('Đắc Nhân Tâm'), 'dac nhan tam');
    assert.equal(normalizeVi(''), '');
});

test('rankBooksSmart returns empty results for blank queries and respects limit', () => {
    assert.deepEqual(rankBooksSmart(SAMPLE_BOOKS, '   ').books, []);
    const limited = rankBooksSmart(SAMPLE_BOOKS, 'n', 1);
    assert.ok(limited.books.length <= 1);
});

test('rankBooksSmart matches accented/unaccented queries and prioritizes exact title matches', () => {
    const result = rankBooksSmart(SAMPLE_BOOKS, 'mat biec');
    assert.ok(result.books.length >= 1);
    assert.equal(result.books[0].title, 'Mắt Biếc');
});

test('rankBooksSmart handles Vietnamese phonetic and English typo queries via fuzzy matching', () => {
    const viTypo = rankBooksSmart(SAMPLE_BOOKS, 'mac biet');
    assert.ok(viTypo.books.some((b) => b.title === 'Mắt Biếc'));

    const enTypo = rankBooksSmart(SAMPLE_BOOKS, 'clen code');
    assert.ok(enTypo.books.some((b) => b.title === 'Clean Code'));
});
