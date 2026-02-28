import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'JWT_SECRET'];
const OPTIONAL_ENV_VARS = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'VK_CLIENT_ID', 'VK_CLIENT_SECRET', 'YANDEX_CLIENT_ID', 'YANDEX_CLIENT_SECRET'];

console.log('[INFO] Checking environment variables...');
const missingRequired = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingRequired.length > 0) {
  console.error(`[ERROR] Missing required environment variables: ${missingRequired.join(', ')}`);
  process.exit(1);
}

const missingOptional = OPTIONAL_ENV_VARS.filter(v => !process.env[v]);
if (missingOptional.length > 0) {
  console.warn(`[WARN] Missing optional environment variables: ${missingOptional.join(', ')}`);
  console.warn('[WARN] Some features may not work (S3 media storage)');
}

console.log('[INFO] Environment variables OK');

import authRouter from './routes/auth';
import mediaRouter from './routes/media';
import webhookRouter from './routes/webhook';
import telegramRouter from './routes/telegram';
import telegramChatSyncRouter from './routes/telegram-chat-sync';
import sellersRouter from './routes/sellers';
import databaseRouter from './routes/database';
import storageRouter from './routes/storage';
import rpcRouter from './routes/rpc';
import pool from './db';

async function checkDatabaseConnection(): Promise<boolean> {
  try {
    console.log('[INFO] Testing database connection...');
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('[INFO] Database connection successful');
    return true;
  } catch (err) {
    console.error('[ERROR] Database connection failed:', err);
    return false;
  }
}

app.use(cors({
  origin: process.env.APP_URL || '*',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/db', databaseRouter);
app.use('/api/storage', storageRouter);
app.use('/api/rpc', rpcRouter);
app.use('/api/media', mediaRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/telegram-chat-sync', telegramChatSyncRouter);
app.use('/api/sellers', sellersRouter);
app.use('/api/webhook', webhookRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

(async () => {
  const dbOk = await checkDatabaseConnection();
  if (!dbOk) {
    console.error('[ERROR] Cannot start server - database not available');
    process.exit(1);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[INFO] KeyKurs backend listening on port ${PORT}`);
    console.log(`[INFO] Health check: http://localhost:${PORT}/health`);
    console.log('[INFO] Server ready to accept connections');
  });

  server.on('error', (err) => {
    console.error('[ERROR] Server error:', err);
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    console.log('[INFO] SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('[INFO] Server closed');
      process.exit(0);
    });
  });
})();

export default app;
