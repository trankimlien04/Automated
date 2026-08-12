const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get all system configs (Any authenticated user)
router.get('/', authenticateToken, configController.getConfigs);

// Update system configs (Only Admin)
router.put('/', authenticateToken, requireRole(['admin']), configController.updateConfigs);

module.exports = router;
