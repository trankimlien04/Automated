const express = require('express');
const router = express.Router();
const historyController = require('../controllers/historyController');

router.get('/user/:userId', historyController.getUserHistory);
router.post('/', historyController.addHistory);
router.delete('/:id', historyController.deleteHistory);

module.exports = router;
