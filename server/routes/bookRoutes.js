const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get books - Open to all authenticated users
router.get('/', authenticateToken, bookController.getAllBooks);
router.get('/:id', authenticateToken, bookController.getBookById);

// Create, Update, Delete - Only Admin and Librarian
router.post('/', authenticateToken, requireRole(['admin', 'librarian']), bookController.createBook);
router.put('/:id', authenticateToken, requireRole(['admin', 'librarian']), bookController.updateBook);
router.delete('/:id', authenticateToken, requireRole(['admin', 'librarian']), bookController.deleteBook);

module.exports = router;
