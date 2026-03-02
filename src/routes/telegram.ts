import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import {
  TelegramMessage,
  extractMediaData,
  processAndDownloadMedia
} from '../utils/telegram.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

// Helper function to get Telegram updates
async function getTelegramUpdates(botToken: string, offset: number = 0) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offset,
      timeout: 5,
      allowed_updates: ['my_chat_member', 'message'],
    }),
  });

  const data: any = await response.json();
  return data.result || [];
}

// POST /api/telegram/register-webhook - Register webhook for a bot
router.post('/register-webhook', async (req: Request, res: Response) => {
  try {
    const { botToken, botId, webhookUrl } = req.body;

    if (!botToken || !botId) {
      return res.status(400).json({ error: 'botToken and botId are required' });
    }

    const baseUrl = webhookUrl || process.env.API_URL || process.env.BACKEND_URL;

    if (!baseUrl) {
      return res.status(500).json({ error: 'webhookUrl or API_URL environment variable required' });
    }

    const fullWebhookUrl = `${baseUrl}/api/telegram/webhook/${botId}`;

    // Register webhook with Telegram
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: fullWebhookUrl,
        allowed_updates: ['message', 'channel_post'],
        drop_pending_updates: false,
      }),
    });

    const result: any = await telegramResponse.json();

    if (result.ok) {
      // Get webhook info
      const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const info: any = await infoResponse.json();

      res.json({
        success: true,
        webhookUrl: fullWebhookUrl,
        telegramResponse: result,
        webhookInfo: info,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.description || 'Failed to register webhook',
        telegramResponse: result,
      });
    }
  } catch (error) {
    console.error('Webhook registration error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/telegram/webhook/:botId - Handle incoming Telegram webhook
router.post('/webhook/:botId', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const botId = Array.isArray(req.params.botId) ? req.params.botId[0] : req.params.botId;
    const update: TelegramUpdate = req.body;

    logger.info(`Received webhook for bot ${botId}`, { update_id: update.update_id });

    // Immediately respond to Telegram
    res.json({ ok: true });

    // Process webhook asynchronously
    processWebhookAsync(pool, botId, update).catch((error) => {
      logger.error('Error processing webhook:', error);
    });
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Process webhook update asynchronously with media download
 */
async function processWebhookAsync(pool: Pool, botId: string, update: TelegramUpdate) {
  try {
    const message = update.channel_post || update.message;

    if (!message) {
      logger.debug('No message in update');
      return;
    }

    // Get bot info
    const botResult = await pool.query(
      'SELECT id, bot_token, seller_id FROM telegram_bots WHERE id = $1',
      [botId]
    );

    if (botResult.rows.length === 0) {
      logger.warn(`Bot ${botId} not found`);
      return;
    }

    const bot = botResult.rows[0];

    // Check if message is from a linked chat
    const isChannelPost = !!update.channel_post;
    const chatId = message.chat.id;

    const chatResult = await pool.query(
      `SELECT tsc.course_id, tsc.chat_title
       FROM telegram_seller_chats tsc
       WHERE tsc.seller_bot_id = $1
         AND tsc.telegram_chat_id = $2
         AND tsc.is_active = true`,
      [botId, chatId.toString()]
    );

    if (chatResult.rows.length === 0) {
      logger.debug(`Message from unlinked chat ${chatId}`);
      return;
    }

    const { course_id } = chatResult.rows[0];

    // Handle media groups
    if (message.media_group_id) {
      await handleMediaGroupMessage(pool, bot.bot_token, course_id, message);
      return;
    }

    // Handle single message with automatic media download
    await handleSingleMessage(pool, bot.bot_token, course_id, message);
  } catch (error) {
    logger.error('Error in processWebhookAsync:', error);
    throw error;
  }
}

/**
 * Handle a single message (not part of media group)
 */
async function handleSingleMessage(
  pool: Pool,
  botToken: string,
  courseId: string,
  message: TelegramMessage
) {
  try {
    const textContent = message.text || message.caption || '';

    // Process and download media
    const { mediaData, localPath, thumbnailPath } = await processAndDownloadMedia(
      botToken,
      message
    );

    // Insert post into database
    const postResult = await pool.query(
      `INSERT INTO course_posts (
        course_id,
        source_type,
        title,
        text_content,
        media_type,
        telegram_file_id,
        s3_url,
        telegram_thumbnail_file_id,
        thumbnail_s3_url,
        telegram_message_id,
        file_size,
        file_name,
        mime_type,
        telegram_media_width,
        telegram_media_height,
        telegram_media_duration,
        has_error,
        error_message,
        published_at,
        order_index
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id`,
      [
        courseId,
        'telegram',
        '', // title
        textContent,
        mediaData.media_type,
        mediaData.file_id, // Keep as fallback
        localPath || null, // Local path in s3_url column
        mediaData.thumbnail_file_id,
        thumbnailPath || null,
        message.message_id,
        mediaData.file_size,
        mediaData.file_name,
        mediaData.mime_type,
        mediaData.width,
        mediaData.height,
        mediaData.duration,
        mediaData.has_error,
        mediaData.error_message,
        new Date(message.date * 1000).toISOString(),
        0
      ]
    );

    logger.info(`Created post ${postResult.rows[0].id} for course ${courseId}`, {
      media_type: mediaData.media_type,
      downloaded: !!localPath,
      has_error: mediaData.has_error
    });
  } catch (error) {
    logger.error('Error handling single message:', error);
    throw error;
  }
}

/**
 * Handle media group message (buffered processing)
 */
async function handleMediaGroupMessage(
  pool: Pool,
  botToken: string,
  courseId: string,
  message: TelegramMessage
) {
  try {
    const mediaData = extractMediaData(message);

    // Buffer media group item
    await pool.query(
      `INSERT INTO telegram_media_group_buffer (
        course_id,
        media_group_id,
        telegram_message_id,
        media_data,
        caption,
        message_date
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        courseId,
        message.media_group_id,
        message.message_id,
        JSON.stringify(mediaData),
        message.caption || null,
        new Date(message.date * 1000).toISOString()
      ]
    );

    logger.info(`Buffered media group item: ${message.media_group_id}`);

    // Schedule processing after 3 seconds
    setTimeout(async () => {
      try {
        await processMediaGroup(pool, botToken, courseId, message.media_group_id!);
      } catch (error) {
        logger.error('Error processing media group:', error);
      }
    }, 3000);
  } catch (error) {
    logger.error('Error handling media group message:', error);
    throw error;
  }
}

/**
 * Process buffered media group
 */
async function processMediaGroup(
  pool: Pool,
  botToken: string,
  courseId: string,
  mediaGroupId: string
) {
  try {
    // Get all buffered items
    const bufferResult = await pool.query(
      `SELECT id, telegram_message_id, media_data, caption, message_date
       FROM telegram_media_group_buffer
       WHERE course_id = $1 AND media_group_id = $2
       ORDER BY telegram_message_id ASC`,
      [courseId, mediaGroupId]
    );

    if (bufferResult.rows.length === 0) {
      return;
    }

    const items = bufferResult.rows;
    const firstItem = items[0];
    const caption = items.find(item => item.caption)?.caption || '';

    // Create main post
    const postResult = await pool.query(
      `INSERT INTO course_posts (
        course_id,
        source_type,
        title,
        text_content,
        media_type,
        telegram_message_id,
        published_at,
        order_index
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        courseId,
        'telegram',
        '',
        caption,
        'media_group',
        firstItem.telegram_message_id,
        firstItem.message_date,
        0
      ]
    );

    const postId = postResult.rows[0].id;

    // Download and insert each media item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mediaData = JSON.parse(item.media_data);

      // Download media
      let localPath: string | undefined;
      let thumbnailPath: string | undefined;

      if (mediaData.file_id) {
        const downloadResult = await processAndDownloadMedia(botToken, {
          message_id: item.telegram_message_id,
          date: Math.floor(new Date(item.message_date).getTime() / 1000),
          chat: { id: 0, type: 'channel' },
          ...mediaData
        });

        localPath = downloadResult.localPath;
        thumbnailPath = downloadResult.thumbnailPath;
      }

      // Insert media item
      await pool.query(
        `INSERT INTO course_post_media (
          post_id,
          media_type,
          telegram_file_id,
          s3_url,
          telegram_thumbnail_file_id,
          thumbnail_s3_url,
          file_size,
          file_name,
          mime_type,
          media_width,
          media_height,
          media_duration,
          media_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          postId,
          mediaData.media_type,
          mediaData.file_id,
          localPath || null,
          mediaData.thumbnail_file_id,
          thumbnailPath || null,
          mediaData.file_size,
          mediaData.file_name,
          mediaData.mime_type,
          mediaData.width,
          mediaData.height,
          mediaData.duration,
          i
        ]
      );
    }

    // Clear buffer
    await pool.query(
      'DELETE FROM telegram_media_group_buffer WHERE course_id = $1 AND media_group_id = $2',
      [courseId, mediaGroupId]
    );

    logger.info(`Processed media group ${mediaGroupId}: ${items.length} items, post ${postId}`);
  } catch (error) {
    logger.error('Error processing media group:', error);
    throw error;
  }
}

// GET /api/telegram/chat-sync/get-chats - Get available chats for a bot
router.get('/chat-sync/get-chats', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { bot_id } = req.query;

    if (!bot_id) {
      return res.status(400).json({ error: 'bot_id is required' });
    }

    const botResult = await pool.query(
      'SELECT id, bot_token, seller_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const bot = botResult.rows[0];

    // Get updates from Telegram
    const updates = await getTelegramUpdates(bot.bot_token);

    const chatsMap = new Map();
    for (const update of updates) {
      if (update.my_chat_member?.status === 'administrator') {
        const chat = update.my_chat_member.chat;
        if (!chatsMap.has(chat.id)) {
          chatsMap.set(chat.id, {
            id: chat.id,
            title: chat.title,
            type: chat.type,
          });
        }
      }
    }

    res.json({
      ok: true,
      chats: Array.from(chatsMap.values()),
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/telegram/chat-sync/link-chat - Link a chat to a course
router.post('/chat-sync/link-chat', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { bot_id, chat_id, chat_title, chat_type, course_id } = req.body;

    if (!bot_id || !chat_id || !course_id) {
      return res.status(400).json({ error: 'bot_id, chat_id, and course_id are required' });
    }

    const botResult = await pool.query(
      'SELECT id, seller_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    await pool.query(
      `INSERT INTO telegram_seller_chats (seller_bot_id, course_id, telegram_chat_id, chat_title, chat_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (seller_bot_id, course_id, telegram_chat_id) DO UPDATE
       SET chat_title = $4, chat_type = $5, is_active = $6`,
      [bot_id, course_id, chat_id, chat_title, chat_type, true]
    );

    res.json({
      ok: true,
      message: 'Chat successfully linked to course',
    });
  } catch (error) {
    console.error('Error linking chat:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

// DELETE /api/telegram/chat-sync/unlink-chat - Unlink a chat from a course
router.delete('/chat-sync/unlink-chat', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { bot_id, chat_id, course_id } = req.body;

    if (!bot_id || !chat_id || !course_id) {
      return res.status(400).json({ error: 'bot_id, chat_id, and course_id are required' });
    }

    await pool.query(
      'DELETE FROM telegram_seller_chats WHERE seller_bot_id = $1 AND telegram_chat_id = $2 AND course_id = $3',
      [bot_id, chat_id, course_id]
    );

    res.json({
      ok: true,
      message: 'Chat successfully unlinked',
    });
  } catch (error) {
    console.error('Error unlinking chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/telegram/chat-sync/list-chats - List linked chats for a bot
router.get('/chat-sync/list-chats', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { bot_id } = req.query;

    if (!bot_id) {
      return res.status(400).json({ error: 'bot_id is required' });
    }

    const botResult = await pool.query(
      'SELECT id, seller_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const chatsResult = await pool.query(
      'SELECT id, telegram_chat_id, chat_title, chat_type, course_id, is_active FROM telegram_seller_chats WHERE seller_bot_id = $1',
      [bot_id]
    );

    res.json({
      ok: true,
      chats: chatsResult.rows,
    });
  } catch (error) {
    console.error('Error listing chats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
