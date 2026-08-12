const express = require('express');
const router = express.Router();
const recommendationController = require('../controllers/recommendationController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Get personalized recommendations (Any logged in user)
router.get('/', authenticateToken, recommendationController.getRecommendations);

module.exports = router;
