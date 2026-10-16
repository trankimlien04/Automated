const express = require('express');
const router = express.Router();
const fineController = require('../controllers/fineController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Get fines (all users but readers only see theirs)
router.get('/', authenticateToken, fineController.getFines);

// Get library bank configuration for VietQR payment
router.get('/bank-config', authenticateToken, fineController.getBankConfig);

// Pay fine (Librarian/Admin at counter, or Reader online)
router.put('/:id/pay', authenticateToken, fineController.payFine);

module.exports = router;

