const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, searchController.globalSearch);

module.exports = router;
