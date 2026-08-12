const express = require('express');
const router = express.Router();
const fineController = require('../controllers/fineController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get fines (all users but readers only see theirs)
router.get('/', authenticateToken, fineController.getFines);

// Pay fine (Only Admin & Librarian)
router.put('/:id/pay', authenticateToken, requireRole(['admin', 'librarian']), fineController.payFine);

module.exports = router;
