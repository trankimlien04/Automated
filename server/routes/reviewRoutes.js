const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/book/:bookId', reviewController.getReviewsByBook);
router.post('/', authenticateToken, reviewController.addReview);
router.delete('/:id', authenticateToken, reviewController.deleteReview);

module.exports = router;
