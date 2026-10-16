const express = require('express');
const router = express.Router();
const reservationController = require('../controllers/reservationController');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');

// Get all reservations (all users but readers only see theirs)
router.get('/', authenticateToken, reservationController.getReservations);

// Create a new reservation (available to readers, admins, librarians)
router.post('/', authenticateToken, reservationController.createReservation);

// Cancel a reservation (supports PUT /:id/cancel, DELETE /:id, DELETE /:id/cancel)
router.put('/:id/cancel', authenticateToken, reservationController.cancelReservation);
router.delete('/:id', authenticateToken, reservationController.cancelReservation);
router.delete('/:id/cancel', authenticateToken, reservationController.cancelReservation);

// Complete a reservation (Only Admin & Librarian)
router.put('/:id/complete', authenticateToken, requireRole(['admin', 'librarian']), reservationController.completeReservation);

module.exports = router;
