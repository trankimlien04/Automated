const express = require('express');
const router = express.Router();
const borrowController = require('../controllers/borrowController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get borrow records / history (available to everyone, but readers only see theirs)
router.get('/records', authenticateToken, borrowController.getBorrowRecords);

// Borrow a book (Librarian/Admin or Reader Self-Service)
router.post('/borrow', authenticateToken, borrowController.borrowBook);

// Borrow Requests (Đăng ký mượn online / Giỏ mượn sách có sẵn)
router.get('/requests', authenticateToken, borrowController.getBorrowRequests);
router.post('/requests', authenticateToken, borrowController.createBorrowRequest);
router.delete('/requests/:id', authenticateToken, borrowController.cancelBorrowRequest);
router.post('/requests/:id/fulfill', authenticateToken, requireRole(['admin', 'librarian']), borrowController.fulfillBorrowRequest);

// Return a book (Only Admin & Librarian)
router.post('/return', authenticateToken, requireRole(['admin', 'librarian']), borrowController.returnBook);


// Renew a book borrow record
router.post('/renew', authenticateToken, borrowController.renewBook);

// Get reader checkout info and pending requests when scanning Reader Card QR (Only Librarian/Admin)
router.get('/reader-checkout-info/:cardNumber', authenticateToken, requireRole(['admin', 'librarian']), borrowController.getReaderCheckoutInfo);

// Approve and fulfill reservation into borrow record (Only Librarian/Admin)
router.post('/approve-reservation', authenticateToken, requireRole(['admin', 'librarian']), borrowController.approveReservation);

// Check book copy information by QR code
router.get('/check-copy/:qrCode', authenticateToken, borrowController.checkBookCopy);

module.exports = router;
