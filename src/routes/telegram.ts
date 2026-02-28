import { Router, Request, Response } from 'express';
import { queryOne } from '../db';

const router = Router();

router.get('/bot-username', async (_req: Request, res: Response) => {
  try {
    const mainBot = await queryOne<{ bot_username: string }>(
      'SELECT bot_username FROM telegram_main_bot WHERE is_active = true LIMIT 1'
    );

    if (mainBot?.bot_username) {
      res.json({ bot_username: mainBot.bot_username });
      return;
    }

    const fallback = await queryOne<{ bot_username: string }>(
      'SELECT bot_username FROM telegram_bots LIMIT 1'
    );

    res.json({ bot_username: fallback?.bot_username || null });
  } catch (err) {
    console.error('Bot username error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
