const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, uploadController.uploadImage);

module.exports = router;
