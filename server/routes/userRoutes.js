const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get all users - Only Admin and Librarian can view the readers list
router.get('/', authenticateToken, requireRole(['admin', 'librarian']), userController.getAllUsers);

// Create a new user account - Only Admin has permission to create Librarian or Reader accounts directly
router.post('/', authenticateToken, requireRole(['admin']), userController.createUser);

// Get user profile - Authenticated users can view their own, Admin and Librarian can view any
router.get('/:id', authenticateToken, userController.getUserProfile);

// Update status - Only Admin and Librarian can lock/unlock/approve accounts
router.put('/:id/status', authenticateToken, requireRole(['admin', 'librarian']), userController.updateUserStatus);

module.exports = router;
