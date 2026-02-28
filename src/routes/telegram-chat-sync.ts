import { Router, Request, Response } from 'express';
import { query, queryOne, queryMany } from '../db';
import { authenticateToken, AuthRequest } from '../auth';
import fetch from 'node-fetch';

const router = Router();

interface TelegramChat {
  id: number;
  title?: string;
  type: string;
  username?: string;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result?: Array<{
    update_id: number;
    message?: {
      chat: TelegramChat;
    };
    channel_post?: {
      chat: TelegramChat;
    };
  }>;
}

async function getTelegramBotChats(botToken: string): Promise<TelegramChat[]> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;

  const response = await fetch(url);
  const data = await response.json() as TelegramGetUpdatesResponse;

  if (!data.ok || !data.result) {
    return [];
  }

  const chatsMap = new Map<number, TelegramChat>();

  for (const update of data.result) {
    const chat = update.message?.chat || update.channel_post?.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
      chatsMap.set(chat.id, chat);
    }
  }

  return Array.from(chatsMap.values());
}

router.get('/chats/:botId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { botId } = req.params;

    const bot = await queryOne<{ id: string; bot_token: string; course_id: string }>(
      'SELECT id, bot_token, course_id FROM telegram_bots WHERE id = $1',
      [botId]
    );

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const course = await queryOne<{ seller_id: string }>(
      'SELECT seller_id FROM courses WHERE id = $1',
      [bot.course_id]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const seller = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sellers WHERE id = $1',
      [course.seller_id]
    );

    if (!seller || seller.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!bot.bot_token) {
      return res.status(400).json({ error: 'Bot token not configured' });
    }

    const chats = await getTelegramBotChats(bot.bot_token);

    res.json({ ok: true, chats });
  } catch (err) {
    console.error('Get chats error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.get('/linked-chats/:botId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { botId } = req.params;

    const bot = await queryOne<{ id: string; course_id: string }>(
      'SELECT id, course_id FROM telegram_bots WHERE id = $1',
      [botId]
    );

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const course = await queryOne<{ seller_id: string }>(
      'SELECT seller_id FROM courses WHERE id = $1',
      [bot.course_id]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const seller = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sellers WHERE id = $1',
      [course.seller_id]
    );

    if (!seller || seller.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const linkedChats = await queryMany<{
      id: string;
      bot_id: string;
      chat_id: number;
      chat_title: string;
      chat_type: string;
      course_id: string | null;
      created_at: string;
    }>(
      'SELECT * FROM telegram_linked_chats WHERE bot_id = $1',
      [botId]
    );

    res.json({ ok: true, chats: linkedChats });
  } catch (err) {
    console.error('List linked chats error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.post('/link-chat', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { bot_id, chat_id, chat_title, chat_type, course_id } = req.body;

    if (!bot_id || !chat_id || !chat_title || !chat_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const bot = await queryOne<{ id: string; course_id: string }>(
      'SELECT id, course_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const course = await queryOne<{ seller_id: string }>(
      'SELECT seller_id FROM courses WHERE id = $1',
      [bot.course_id]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const seller = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sellers WHERE id = $1',
      [course.seller_id]
    );

    if (!seller || seller.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      `INSERT INTO telegram_linked_chats (bot_id, chat_id, chat_title, chat_type, course_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bot_id, chat_id)
       DO UPDATE SET chat_title = $3, chat_type = $4, course_id = $5`,
      [bot_id, chat_id, chat_title, chat_type, course_id || null]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Link chat error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.delete('/unlink-chat', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { bot_id, chat_id } = req.body;

    if (!bot_id || !chat_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const bot = await queryOne<{ id: string; course_id: string }>(
      'SELECT id, course_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const course = await queryOne<{ seller_id: string }>(
      'SELECT seller_id FROM courses WHERE id = $1',
      [bot.course_id]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const seller = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM sellers WHERE id = $1',
      [course.seller_id]
    );

    if (!seller || seller.user_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await query(
      'DELETE FROM telegram_linked_chats WHERE bot_id = $1 AND chat_id = $2',
      [bot_id, chat_id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Unlink chat error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

export default router;
