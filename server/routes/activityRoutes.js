const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

// If authMiddleware exists, we use it or create basic route
router.get('/', activityController.getActivityLogs);

module.exports = router;
