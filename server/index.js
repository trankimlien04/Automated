require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Test Route
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'success', message: 'Smart Library API is running' });
});

// Import Routes
const authRoutes = require('./routes/authRoutes');
const bookRoutes = require('./routes/bookRoutes');
const userRoutes = require('./routes/userRoutes');
const borrowRoutes = require('./routes/borrowRoutes');
const reservationRoutes = require('./routes/reservationRoutes');
const fineRoutes = require('./routes/fineRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const recommendationRoutes = require('./routes/recommendationRoutes');
const configRoutes = require('./routes/configRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const authorRoutes = require('./routes/authorRoutes');
const publisherRoutes = require('./routes/publisherRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const historyRoutes = require('./routes/historyRoutes');
const activityRoutes = require('./routes/activityRoutes');
const searchRoutes = require('./routes/searchRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/users', userRoutes);
app.use('/api/borrow', borrowRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/fines', fineRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/configs', configRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/authors', authorRoutes);
app.use('/api/publishers', publisherRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/activity-logs', activityRoutes);
app.use('/api/search', searchRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    const initDb = require('./config/initDb');
    await initDb();
    const initCronJobs = require('./services/cronJobs');
    initCronJobs();
});
