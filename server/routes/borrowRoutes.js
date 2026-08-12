const express = require('express');
const router = express.Router();
const borrowController = require('../controllers/borrowController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get borrow records / history (available to everyone, but readers only see theirs)
router.get('/records', authenticateToken, borrowController.getBorrowRecords);

// Borrow a book (Only Admin & Librarian)
router.post('/borrow', authenticateToken, requireRole(['admin', 'librarian']), borrowController.borrowBook);

// Return a book (Only Admin & Librarian)
router.post('/return', authenticateToken, requireRole(['admin', 'librarian']), borrowController.returnBook);

// Renew a book borrow record
router.post('/renew', authenticateToken, borrowController.renewBook);

module.exports = router;
