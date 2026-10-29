const db = require('./server/config/db');

async function check() {
    try {
        const [c] = await db.execute(`
            SELECT bc.id, bc.book_id, b.title, bc.qr_code, bc.status 
            FROM book_copies bc 
            JOIN books b ON bc.book_id = b.id 
            WHERE bc.status = 'borrowed'
        `);
        console.log('Borrowed copies count:', c.length);
        console.log('Sample borrowed copies:', c.slice(0, 5));

        const [br] = await db.execute(`
            SELECT br.id, br.user_id, u.full_name, br.book_copy_id, bc.qr_code, b.title, br.status 
            FROM borrow_records br 
            JOIN users u ON br.user_id = u.id 
            JOIN book_copies bc ON br.book_copy_id = bc.id 
            JOIN books b ON bc.book_id = b.id 
            WHERE br.status = 'borrowing'
        `);
        console.log('Active borrow records count:', br.length);
        console.log('Active borrow records:', br);

        const [drafts] = await db.execute(`
            SELECT d.id, d.draft_code, u.full_name, d.status, di.book_id, b.title, di.book_copy_id, di.status as item_status, bc.qr_code as assigned_qr
            FROM borrow_drafts d 
            JOIN users u ON d.user_id = u.id 
            JOIN borrow_draft_items di ON d.id = di.draft_id 
            JOIN books b ON di.book_id = b.id 
            LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
            WHERE d.status = 'pending'
        `);
        console.log('Pending drafts & items:', drafts);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

check();
