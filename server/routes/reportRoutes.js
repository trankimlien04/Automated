const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get dashboard stats - Accessible to Admin, Librarian and Owner
router.get('/dashboard', authenticateToken, requireRole(['admin', 'librarian', 'owner']), reportController.getDashboardStats);

// Get filtered analytics data (day, week, month, year)
router.get('/analytics', authenticateToken, requireRole(['admin', 'librarian', 'owner']), reportController.getAnalytics);

module.exports = router;
