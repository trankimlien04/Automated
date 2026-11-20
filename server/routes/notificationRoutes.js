const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

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

// Trigger manual system reminders check (Staff / Owner)
router.post('/trigger-reminders', authenticateToken, requireRole(['admin', 'librarian', 'owner']), notificationController.triggerManualReminders);

// Get notification dispatches history (Email & Multi-channel Logs)
router.get('/dispatch-history', authenticateToken, notificationController.getDispatchHistory);

// Optional reader email channel preferences (e.g. counter borrow/return receipts)
router.get('/preferences', authenticateToken, notificationController.getNotificationPreferences);
router.put('/preferences', authenticateToken, notificationController.updateNotificationPreferences);

// Inspect or verify live SMTP server configuration
router.get('/smtp-status', authenticateToken, requireRole(['admin', 'librarian', 'owner']), notificationController.getSmtpStatus);
router.post('/smtp-verify', authenticateToken, requireRole(['admin', 'librarian', 'owner']), notificationController.verifySmtpConnection);
router.put('/smtp-config', authenticateToken, requireRole(['admin', 'owner']), notificationController.updateSmtpConfig);
router.delete('/smtp-config', authenticateToken, requireRole(['admin', 'owner']), notificationController.resetSmtpConfig);

// Test send an email notification (Staff / Owner)
router.post('/test-email', authenticateToken, requireRole(['admin', 'librarian', 'owner']), notificationController.testSendEmail);

// Broadcast announcement / direct notification (Staff / Owner)
router.post('/broadcast', authenticateToken, requireRole(['admin', 'librarian', 'owner']), notificationController.broadcastNotification);

// Mark specific notification as read
router.put('/:id/read', authenticateToken, notificationController.markAsRead);

// Delete specific notification
router.delete('/:id', authenticateToken, notificationController.deleteNotification);

module.exports = router;
