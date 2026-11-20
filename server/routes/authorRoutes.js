const express = require('express');
const router = express.Router();
const authorController = require('../controllers/authorController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

router.get('/', authorController.getAllAuthors);
router.get('/:id', authorController.getAuthorById);
router.post('/', authenticateToken, requireRole(['admin', 'librarian']), authorController.createAuthor);
router.put('/:id', authenticateToken, requireRole(['admin', 'librarian']), authorController.updateAuthor);
router.delete('/:id', authenticateToken, requireRole(['admin', 'librarian']), authorController.deleteAuthor);

module.exports = router;
