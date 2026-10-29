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

// Batch mark notifications as read
router.put('/batch-read', authenticateToken, notificationController.batchMarkRead);

// Clear all read notifications
router.delete('/clear-read', authenticateToken, notificationController.clearReadNotifications);

// Batch delete notifications
router.delete('/batch-delete', authenticateToken, notificationController.batchDelete);

// Delete all notifications
router.delete('/delete-all', authenticateToken, notificationController.deleteAllNotifications);

// Trigger manual system reminders check
router.post('/trigger-reminders', authenticateToken, notificationController.triggerManualReminders);

// Get notification dispatches history (Email & Multi-channel Logs)
router.get('/dispatch-history', authenticateToken, notificationController.getDispatchHistory);

// Test send an email notification
router.post('/test-email', authenticateToken, notificationController.testSendEmail);

// Broadcast announcement / direct notification
router.post('/broadcast', authenticateToken, notificationController.broadcastNotification);

// Mark specific notification as read
router.put('/:id/read', authenticateToken, notificationController.markAsRead);

// Delete specific notification
router.delete('/:id', authenticateToken, notificationController.deleteNotification);

module.exports = router;
