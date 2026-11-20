const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Admin and Owner see all logs; Librarian sees own + warehouse/book related logs
router.get('/', authenticateToken, requireRole(['admin', 'owner', 'librarian']), activityController.getActivityLogs);

module.exports = router;
