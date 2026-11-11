const express = require('express');
const router = express.Router();
const fineController = require('../controllers/fineController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get violation & remediation ledger (all for staff, own for readers)
router.get('/', authenticateToken, fineController.getFines);

// Get evaluated circulation discipline status (OVERDUE / SUSPENDED / PENDING_REMEDIATION / ELIGIBLE)
router.get('/circulation-status', authenticateToken, fineController.getCirculationStatus);

// Report damaged/lost book incident awaiting physical remediation (Librarian/Admin)
router.post('/incidents', authenticateToken, requireRole(['admin', 'librarian']), fineController.reportBookIncident);

// Confirm physical remediation & re-evaluate reader circulation eligibility (Librarian/Admin)
router.put('/:id/resolve', authenticateToken, requireRole(['admin', 'librarian']), fineController.resolveViolation);

module.exports = router;

