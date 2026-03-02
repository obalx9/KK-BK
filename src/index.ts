import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import coursesRouter from './routes/courses.js';
import postsRouter from './routes/posts.js';
import mediaRouter from './routes/media.js';
import adminRouter from './routes/admin.js';
import adsRouter from './routes/ads.js';
import featuredRouter from './routes/featured.js';
import statsRouter from './routes/stats.js';
import authRouter from './routes/auth.js';
import telegramRouter from './routes/telegram.js';
import oauthRouter from './routes/oauth.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

app.get('/', (req, res) => {
  res.json({
    name: 'KeyKurs Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes (no auth required)
app.use('/api/auth', authRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/ads', adsRouter);
app.use('/api/featured', featuredRouter);

// Protected routes (auth required)
app.use('/api/courses', authMiddleware, coursesRouter);
app.use('/api/posts', authMiddleware, postsRouter);
app.use('/api/media', authMiddleware, mediaRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/stats', authMiddleware, statsRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
