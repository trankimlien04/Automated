const express = require('express');
const router = express.Router();
const recommendationController = require('../controllers/recommendationController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Get personalized recommendations with mode filter (hybrid, cbf, preferences, trending, top_rated)
router.get('/', authenticateToken, recommendationController.getRecommendations);

// Get reader preferences (favorite categories & authors) + all options for modal
router.get('/preferences', authenticateToken, recommendationController.getUserPreferences);

// Save / update reader preferences (Cold start & explicit user personalization)
router.post('/preferences', authenticateToken, recommendationController.saveUserPreferences);

// Get real library trending genres and circulation analytics
router.get('/trending', authenticateToken, recommendationController.getTrendingInsights);

module.exports = router;
