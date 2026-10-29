const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// 1. Personal Profile Routes (All authenticated actors: Reader, Librarian, Admin, Owner)
router.get('/profile/me', authenticateToken, userController.getMyProfile);
router.put('/profile/me', authenticateToken, userController.updateMyProfile);
router.put('/profile/change-password', authenticateToken, userController.changePassword);

// 2. User Management Routes
// Get all users - Admin, Librarian and Owner can view users/readers
router.get('/', authenticateToken, requireRole(['admin', 'librarian', 'owner']), userController.getAllUsers);

// Create a new user account - Admin and Owner have permission to create Librarian or Reader accounts directly
router.post('/', authenticateToken, requireRole(['admin', 'owner']), userController.createUser);

// Get user profile by ID
router.get('/:id', authenticateToken, userController.getUserProfile);

// Update status - Admin, Librarian and Owner can lock/unlock/approve accounts
router.put('/:id/status', authenticateToken, requireRole(['admin', 'librarian', 'owner']), userController.updateUserStatus);

module.exports = router;
