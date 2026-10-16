const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get all system configs (Any authenticated user)
router.get('/', authenticateToken, configController.getConfigs);

// Get all config change requests (Admin & Owner)
router.get('/requests', authenticateToken, requireRole(['admin', 'owner']), configController.getConfigRequests);

// Propose config change (Admin only - Maker)
router.post('/propose', authenticateToken, requireRole(['admin']), configController.proposeConfigChange);

// Review (Approve/Reject) config request (Owner only - Checker)
router.patch('/requests/:id/review', authenticateToken, requireRole(['owner']), configController.reviewConfigRequest);

// Direct update fallback (Admin & Owner)
router.put('/', authenticateToken, requireRole(['admin', 'owner']), configController.updateConfigs);

module.exports = router;
