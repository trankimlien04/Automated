const express = require('express');
const router = express.Router();
const publisherController = require('../controllers/publisherController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

router.get('/', publisherController.getAllPublishers);
router.get('/:id', publisherController.getPublisherById);
router.post('/', authenticateToken, requireRole(['admin', 'librarian', 'owner']), publisherController.createPublisher);
router.put('/:id', authenticateToken, requireRole(['admin', 'librarian', 'owner']), publisherController.updatePublisher);
router.delete('/:id', authenticateToken, requireRole(['admin', 'librarian', 'owner']), publisherController.deletePublisher);

module.exports = router;
