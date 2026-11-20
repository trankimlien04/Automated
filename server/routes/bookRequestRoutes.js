const express = require('express');
const router = express.Router();
const bookRequestController = require('../controllers/bookRequestController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Librarian (Maker), Admin (Supervisor), Owner (Checker) can inspect warehouse proposals
router.get('/', authenticateToken, requireRole(['librarian', 'admin', 'owner']), bookRequestController.getBookRequests);

// Only Librarian creates warehouse asset proposals (Admin cannot manipulate stock, Owner reviews)
router.post('/', authenticateToken, requireRole(['librarian']), bookRequestController.createBookRequest);

// Only Owner approves/rejects warehouse proposals (no self-approval enforced in controller)
router.patch('/:id/review', authenticateToken, requireRole(['owner']), bookRequestController.reviewBookRequest);

// Only Librarian creator can cancel a pending proposal
router.patch('/:id/cancel', authenticateToken, requireRole(['librarian']), bookRequestController.cancelBookRequest);

module.exports = router;

