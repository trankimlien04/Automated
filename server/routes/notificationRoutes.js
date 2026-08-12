const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Get all notifications for current user
router.get('/', authenticateToken, notificationController.getNotifications);

// Mark all notifications as read
router.put('/read-all', authenticateToken, notificationController.markAllRead);

// Mark specific notification as read
router.put('/:id/read', authenticateToken, notificationController.markAsRead);

module.exports = router;
