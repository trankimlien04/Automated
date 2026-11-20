const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get books - Open to all authenticated users
router.get('/', authenticateToken, bookController.getAllBooks);

// Smart Shelf Inventory Audit (Kiểm kê kho sách nhanh bằng quét QR hàng loạt)
router.get('/shelf-audit/location', authenticateToken, requireRole(['librarian', 'admin', 'owner']), bookController.getShelfAuditData);
router.post('/shelf-audit/scan', authenticateToken, requireRole(['librarian']), bookController.scanCopyForShelfAudit);

router.get('/:id', authenticateToken, bookController.getBookById);

// Option 4 Risk-Based Warehouse Control:
// - Librarian executes low-risk metadata/location changes directly (audited)
// - Asset-changing or sensitive requests create Maker proposals in book_requests pending Owner review
// - Admin and Owner do not mutate catalog/warehouse inventory directly (403)
router.post('/import-batch', authenticateToken, requireRole(['librarian']), bookController.importBooksBatch);
router.post('/:id/restock', authenticateToken, requireRole(['librarian']), bookController.restockBookCopies);
router.post('/', authenticateToken, requireRole(['librarian']), bookController.createBook);
router.put('/:id', authenticateToken, requireRole(['librarian']), bookController.updateBook);
router.delete('/:id', authenticateToken, requireRole(['librarian']), bookController.deleteBook);

module.exports = router;
