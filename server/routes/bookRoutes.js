const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get books - Open to all authenticated users
router.get('/', authenticateToken, bookController.getAllBooks);

// Smart Shelf Inventory Audit (Kiểm kê kho sách nhanh bằng quét QR hàng loạt)
router.get('/shelf-audit/location', authenticateToken, requireRole(['admin', 'librarian']), bookController.getShelfAuditData);
router.post('/shelf-audit/scan', authenticateToken, requireRole(['admin', 'librarian']), bookController.scanCopyForShelfAudit);

router.get('/:id', authenticateToken, bookController.getBookById);

// Create, Update, Delete, Batch Import - Only Admin and Librarian
router.post('/import-batch', authenticateToken, requireRole(['admin', 'librarian']), bookController.importBooksBatch);
router.post('/:id/restock', authenticateToken, requireRole(['admin', 'librarian', 'owner']), bookController.restockBookCopies);
router.post('/', authenticateToken, requireRole(['admin', 'librarian']), bookController.createBook);
router.put('/:id', authenticateToken, requireRole(['admin', 'librarian', 'owner']), bookController.updateBook);
router.delete('/:id', authenticateToken, requireRole(['admin', 'librarian']), bookController.deleteBook);

module.exports = router;
