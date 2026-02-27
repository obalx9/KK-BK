import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth';
import mediaRouter from './routes/media';
import webhookRouter from './routes/webhook';
import telegramRouter from './routes/telegram';
import sellersRouter from './routes/sellers';

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use('/api/media', mediaRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/sellers', sellersRouter);
app.use('/api/webhook', webhookRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`KeyKurs backend started on port ${PORT}`);
});

export default app;
