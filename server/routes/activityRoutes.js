const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Only Admin and Owner are authorized to access Audit Logs
router.get('/', authenticateToken, requireRole(['admin', 'owner']), activityController.getActivityLogs);

module.exports = router;
