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

// Return a book (Admin, Librarian, or Reader Self-Service)
router.post('/return', authenticateToken, borrowController.returnBook);

// Smart Book Drop 24/7 (Hòm trả sách tự động ngoài giờ)
router.post('/drop-box-return', authenticateToken, borrowController.dropBoxReturn);
router.get('/drop-box-items', authenticateToken, requireRole(['admin', 'librarian', 'owner']), borrowController.getDropBoxItems);
router.post('/drop-box-audit', authenticateToken, requireRole(['admin', 'librarian', 'owner']), borrowController.auditDropBoxItem);

// Physical Security & Loss Prevention: Exit Passes (Vé thông hành ra cửa)
router.get('/exit-passes/my-active', authenticateToken, borrowController.getMyActiveExitPass);
router.get('/exit-passes/active-list', authenticateToken, requireRole(['admin', 'librarian', 'owner']), borrowController.getActiveExitPassesList);
router.post('/exit-passes/verify', authenticateToken, requireRole(['admin', 'librarian', 'owner']), borrowController.verifyExitPass);
router.post('/exit-passes/clear', authenticateToken, requireRole(['admin', 'librarian', 'owner']), borrowController.clearExitPass);

// Batch Return Books (Librarian/Admin receives multiple books in 1 scan / 1 click)
router.post('/batch-return-preview', authenticateToken, requireRole(['admin', 'librarian']), borrowController.previewBatchReturn);
router.post('/batch-return', authenticateToken, requireRole(['admin', 'librarian']), borrowController.batchReturnBooks);


// Renew a book borrow record
router.post('/renew', authenticateToken, borrowController.renewBook);

// Get reader checkout info and pending requests when scanning Reader Card QR (Only Librarian/Admin)
router.get('/reader-checkout-info/:cardNumber', authenticateToken, requireRole(['admin', 'librarian']), borrowController.getReaderCheckoutInfo);

// Approve and fulfill reservation into borrow record (Only Librarian/Admin)
router.post('/approve-reservation', authenticateToken, requireRole(['admin', 'librarian']), borrowController.approveReservation);

// Check book copy information by QR code
router.get('/check-copy/:qrCode', authenticateToken, borrowController.checkBookCopy);

// Draft Borrow Bundle (Phiếu mượn nháp nhiều quyển & Mã QR duyệt nhanh)
router.post('/drafts', authenticateToken, borrowController.createBorrowDraft);
router.post('/drafts/scan-direct', authenticateToken, borrowController.addDirectCopyScan);
router.get('/drafts/my-active', authenticateToken, borrowController.getMyActiveDraft);
router.get('/drafts/pending-list', authenticateToken, requireRole(['admin', 'librarian']), borrowController.getPendingDraftsList);
router.delete('/drafts/items/:itemId', authenticateToken, borrowController.removeDraftItem);
router.get('/drafts/:code', authenticateToken, borrowController.getBorrowDraftByCode);
router.post('/drafts/:code/verify-copy', authenticateToken, borrowController.verifyDraftItemCopy);
router.post('/drafts/:code/approve', authenticateToken, requireRole(['admin', 'librarian']), borrowController.approveBorrowDraft);
router.delete('/drafts/:id', authenticateToken, borrowController.cancelBorrowDraft);

module.exports = router;
