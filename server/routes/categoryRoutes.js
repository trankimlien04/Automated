const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

router.get('/', categoryController.getAllCategories);
router.get('/:id', categoryController.getCategoryById);
router.post('/', authenticateToken, requireRole(['admin', 'librarian', 'owner']), categoryController.createCategory);
router.put('/:id', authenticateToken, requireRole(['admin', 'librarian', 'owner']), categoryController.updateCategory);
router.delete('/:id', authenticateToken, requireRole(['admin', 'librarian', 'owner']), categoryController.deleteCategory);

module.exports = router;
