const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Get all notifications for current user
router.get('/', authenticateToken, notificationController.getNotifications);

// Get unread count for current user
router.get('/unread-count', authenticateToken, notificationController.getUnreadCount);

// Mark all notifications as read
router.put('/read-all', authenticateToken, notificationController.markAllRead);

// Clear all read notifications
router.delete('/clear-read', authenticateToken, notificationController.clearReadNotifications);

// Trigger manual system reminders check
router.post('/trigger-reminders', authenticateToken, notificationController.triggerManualReminders);

// Broadcast announcement / direct notification
router.post('/broadcast', authenticateToken, notificationController.broadcastNotification);

// Mark specific notification as read
router.put('/:id/read', authenticateToken, notificationController.markAsRead);

// Delete specific notification
router.delete('/:id', authenticateToken, notificationController.deleteNotification);

module.exports = router;
