const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get dashboard stats - Only accessible to Admin and Librarian
router.get('/dashboard', authenticateToken, requireRole(['admin', 'librarian']), reportController.getDashboardStats);

module.exports = router;
