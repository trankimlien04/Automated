const express = require('express');
const router = express.Router();
const historyController = require('../controllers/historyController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/user/:userId', authenticateToken, historyController.getUserHistory);
router.post('/', authenticateToken, historyController.addHistory);
router.delete('/:id', authenticateToken, historyController.deleteHistory);

module.exports = router;
