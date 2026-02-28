import { Router, Request, Response } from 'express';
import { queryOne, queryMany } from '../db';
import { authenticateToken, AuthRequest } from '../auth';
import fetch from 'node-fetch';

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

interface TelegramWebhookResponse {
  ok: boolean;
  result?: boolean | Record<string, unknown>;
  description?: string;
}

async function registerTelegramWebhook(
  botToken: string,
  webhookUrl: string
): Promise<TelegramWebhookResponse> {
  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'channel_post'],
      drop_pending_updates: false,
    }),
  });

  return (await response.json()) as TelegramWebhookResponse;
}

async function getTelegramWebhookInfo(botToken: string): Promise<TelegramWebhookResponse> {
  const url = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
  const response = await fetch(url);
  return (await response.json()) as TelegramWebhookResponse;
}

router.post('/register-webhook', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { botId, botToken } = req.body as { botId: string; botToken?: string };

    if (!botId) {
      return res.status(400).json({ error: 'botId is required' });
    }

    const bot = await queryOne<{ id: string; bot_token: string | null }>(
      'SELECT id, bot_token FROM telegram_bots WHERE id = $1',
      [botId]
    );

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const tokenToUse = botToken || bot.bot_token;

    if (!tokenToUse) {
      return res.status(400).json({ error: 'Bot token not found' });
    }

    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    const webhookUrl = `${apiUrl}/api/webhook/${botId}`;

    const result = await registerTelegramWebhook(tokenToUse, webhookUrl);

    if (result.ok) {
      const info = await getTelegramWebhookInfo(tokenToUse);

      await queryOne(
        `UPDATE telegram_bots
         SET webhook_status = 'registered',
             webhook_registered_at = NOW(),
             webhook_error = NULL
         WHERE id = $1`,
        [botId]
      );

      res.json({
        success: true,
        webhookUrl,
        telegramResponse: result,
        webhookInfo: info,
      });
    } else {
      await queryOne(
        `UPDATE telegram_bots
         SET webhook_status = 'failed',
             webhook_error = $2
         WHERE id = $1`,
        [botId, result.description || 'Unknown error']
      );

      res.status(500).json({
        success: false,
        error: result.description || 'Failed to register webhook',
        telegramResponse: result,
      });
    }
  } catch (err) {
    console.error('Webhook registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/register-all-webhooks', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const bots = await queryMany<{ id: string; bot_token: string | null }>(
      'SELECT id, bot_token FROM telegram_bots WHERE bot_token IS NOT NULL'
    );

    const results = [];
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;

    for (const bot of bots) {
      if (!bot.bot_token) continue;

      try {
        const webhookUrl = `${apiUrl}/api/webhook/${bot.id}`;
        const result = await registerTelegramWebhook(bot.bot_token, webhookUrl);

        if (result.ok) {
          await queryOne(
            `UPDATE telegram_bots
             SET webhook_status = 'registered',
                 webhook_registered_at = NOW(),
                 webhook_error = NULL
             WHERE id = $1`,
            [bot.id]
          );

          results.push({
            botId: bot.id,
            success: true,
            webhookUrl,
          });
        } else {
          await queryOne(
            `UPDATE telegram_bots
             SET webhook_status = 'failed',
                 webhook_error = $2
             WHERE id = $1`,
            [bot.id, result.description || 'Unknown error']
          );

          results.push({
            botId: bot.id,
            success: false,
            error: result.description,
          });
        }
      } catch (err) {
        results.push({
          botId: bot.id,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    res.json({
      success: true,
      registered: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (err) {
    console.error('Bulk webhook registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/webhook-status/:botId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { botId } = req.params;

    const bot = await queryOne<{
      id: string;
      webhook_status: string | null;
      webhook_registered_at: string | null;
      webhook_error: string | null;
      bot_token: string | null;
    }>('SELECT id, webhook_status, webhook_registered_at, webhook_error, bot_token FROM telegram_bots WHERE id = $1', [
      botId,
    ]);

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    let telegramInfo = null;

    if (bot.bot_token) {
      try {
        telegramInfo = await getTelegramWebhookInfo(bot.bot_token);
      } catch (err) {
        console.error('Failed to get webhook info from Telegram:', err);
      }
    }

    res.json({
      botId: bot.id,
      webhookStatus: bot.webhook_status,
      webhookRegisteredAt: bot.webhook_registered_at,
      webhookError: bot.webhook_error,
      telegramInfo,
    });
  } catch (err) {
    console.error('Webhook status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
