import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import {
  extractMediaData,
  downloadTelegramFileToS3,
  downloadTelegramThumbnailToS3,
  TelegramMessage,
} from '../telegram-download';

const router = Router();

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

async function getBotToken(botId: string): Promise<string | null> {
  const bot = await queryOne<{ bot_token: string }>(
    'SELECT bot_token FROM telegram_bots WHERE id = $1',
    [botId]
  );
  return bot?.bot_token || null;
}

async function processMediaGroupBuffer(
  botToken: string,
  mediaGroupId: string,
  courseId: string
): Promise<void> {
  const entries = await query<{
    id: string;
    telegram_message_id: number;
    media_data: {
      media_type: string | null;
      file_id: string | null;
      file_size: number | null;
      file_name: string | null;
      mime_type: string | null;
      width: number | null;
      height: number | null;
      duration: number | null;
      thumbnail_file_id: string | null;
      has_error: boolean;
      error_message: string | null;
    };
    caption: string | null;
    message_date: string;
  }>(
    `SELECT * FROM telegram_media_group_buffer
     WHERE media_group_id = $1 AND course_id = $2
     ORDER BY telegram_message_id`,
    [mediaGroupId, courseId]
  );

  if (!entries.length) return;

  const caption = entries.find((e) => e.caption)?.caption || '';
  const messageDate = entries[0].message_date;

  const postResult = await queryOne<{ id: string }>(
    `INSERT INTO course_posts
       (course_id, source_type, title, text_content, media_type, media_group_id, media_count, published_at, order_index)
     VALUES ($1, 'telegram', '', $2, 'media_group', $3, $4, $5, 0)
     RETURNING id`,
    [courseId, caption, mediaGroupId, entries.length, messageDate]
  );

  if (!postResult) return;

  const postId = postResult.id;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const md = entry.media_data;

    let storagePath: string | null = null;
    let thumbnailPath: string | null = null;
    let hasError = md.has_error;
    let errorMessage = md.error_message;

    if (!hasError && md.file_id) {
      const downloaded = await downloadTelegramFileToS3(
        botToken, md.file_id, courseId, md.media_type, md.mime_type, md.file_name
      );
      if (downloaded) {
        storagePath = downloaded.storage_path;
      } else {
        hasError = true;
        errorMessage = 'Не удалось скачать файл из Telegram';
      }

      if (md.thumbnail_file_id) {
        thumbnailPath = await downloadTelegramThumbnailToS3(botToken, md.thumbnail_file_id, courseId);
      }
    }

    await query(
      `INSERT INTO course_post_media
         (post_id, media_type, storage_path, thumbnail_storage_path,
          file_name, file_size, mime_type,
          telegram_media_width, telegram_media_height, telegram_media_duration,
          has_error, error_message, order_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        postId, md.media_type, storagePath, thumbnailPath,
        md.file_name, md.file_size, md.mime_type,
        md.width, md.height, md.duration,
        hasError, errorMessage, i,
      ]
    );
  }

  await query(
    'DELETE FROM telegram_media_group_buffer WHERE media_group_id = $1 AND course_id = $2',
    [mediaGroupId, courseId]
  );
}

function scheduleMediaGroupProcessing(
  botToken: string,
  mediaGroupId: string,
  courseId: string,
  delayMs = 5000
): void {
  setTimeout(async () => {
    try {
      const count = await queryOne<{ cnt: string }>(
        'SELECT COUNT(*) AS cnt FROM telegram_media_group_buffer WHERE media_group_id = $1 AND course_id = $2',
        [mediaGroupId, courseId]
      );
      if (Number(count?.cnt) > 0) {
        await processMediaGroupBuffer(botToken, mediaGroupId, courseId);
      }
    } catch (err) {
      console.error('Error processing media group buffer:', err);
    }
  }, delayMs);
}

async function saveCoursePost(
  botToken: string,
  courseId: string,
  message: TelegramMessage
): Promise<void> {
  if (message.media_group_id) {
    const md = extractMediaData(message);
    await query(
      `INSERT INTO telegram_media_group_buffer
         (course_id, media_group_id, telegram_message_id, media_data, caption, message_date)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        courseId,
        message.media_group_id,
        message.message_id,
        JSON.stringify(md),
        message.caption || null,
        new Date(message.date * 1000).toISOString(),
      ]
    );
    scheduleMediaGroupProcessing(botToken, message.media_group_id, courseId);
    return;
  }

  const md = extractMediaData(message);
  const textContent = message.text || message.caption || '';

  let storagePath: string | null = null;
  let thumbnailPath: string | null = null;
  let hasError = md.has_error;
  let errorMessage = md.error_message;

  if (!hasError && md.file_id) {
    const downloaded = await downloadTelegramFileToS3(
      botToken, md.file_id, courseId, md.media_type, md.mime_type, md.file_name
    );
    if (downloaded) {
      storagePath = downloaded.storage_path;
    } else {
      hasError = true;
      errorMessage = 'Не удалось скачать файл из Telegram';
    }

    if (md.thumbnail_file_id) {
      thumbnailPath = await downloadTelegramThumbnailToS3(botToken, md.thumbnail_file_id, courseId);
    }
  }

  await query(
    `INSERT INTO course_posts
       (course_id, source_type, title, text_content,
        media_type, storage_path, thumbnail_storage_path,
        telegram_message_id, file_size, file_name, mime_type,
        telegram_media_width, telegram_media_height, telegram_media_duration,
        has_error, error_message, published_at, order_index)
     VALUES ($1,'telegram','',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0)`,
    [
      courseId, textContent,
      md.media_type, storagePath, thumbnailPath,
      message.message_id, md.file_size, md.file_name, md.mime_type,
      md.width, md.height, md.duration,
      hasError, errorMessage,
      new Date(message.date * 1000).toISOString(),
    ]
  );
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: object): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
  } catch (err) {
    console.error('Error sending Telegram message:', err);
  }
}

function getMainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '▶️ Начать импорт' }, { text: '⏹ Завершить импорт' }],
      [{ text: '📊 Статус' }, { text: '❓ Помощь' }],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

router.post('/:botId', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });

  const { botId } = req.params;

  try {
    const botToken = await getBotToken(botId);
    if (!botToken) return;

    const update: TelegramUpdate = req.body;
    const message = update.channel_post || update.message;
    if (!message) return;

    const isChannelPost = !!update.channel_post;
    const isPrivateChat = message.chat.type === 'private';
    const telegramUserId = isPrivateChat ? message.chat.id : null;

    if (isChannelPost) {
      const chatId = message.chat.id;

      const botRecord = await queryOne<{ id: string; course_id: string }>(
        `SELECT id, course_id FROM telegram_bots
         WHERE channel_id = $1 AND is_active = true`,
        [chatId.toString()]
      );

      if (botRecord?.course_id) {
        const existing = await queryOne(
          'SELECT id FROM course_posts WHERE course_id = $1 AND telegram_message_id = $2',
          [botRecord.course_id, message.message_id]
        );
        if (!existing) {
          await saveCoursePost(botToken, botRecord.course_id, message);
          await query(
            'UPDATE telegram_bots SET last_sync_at = NOW() WHERE id = $1',
            [botRecord.id]
          );
        }
        return;
      }

      const linkedChats = await query<{ id: string; course_id: string }>(
        `SELECT id, course_id FROM telegram_seller_chats
         WHERE telegram_chat_id = $1 AND is_active = true`,
        [chatId]
      );

      for (const linkedChat of linkedChats) {
        const existing = await queryOne(
          'SELECT id FROM course_posts WHERE course_id = $1 AND telegram_message_id = $2',
          [linkedChat.course_id, message.message_id]
        );
        if (existing) continue;
        await saveCoursePost(botToken, linkedChat.course_id, message);
        await query(
          'UPDATE telegram_seller_chats SET last_sync_at = NOW() WHERE id = $1',
          [linkedChat.id]
        );
      }
      return;
    }

    if (isPrivateChat && message.text) {
      let text = message.text.trim();
      if (text === '▶️ Начать импорт') text = '/import';
      else if (text === '⏹ Завершить импорт') text = '/done';
      else if (text === '📊 Статус') text = '/status';
      else if (text === '❓ Помощь') text = '/help';

      if (text === '/start' || text === '/help') {
        const helpText = `<b>Бот для импорта сообщений в курс</b>\n\n<b>Как использовать:</b>\n1. Нажмите <b>▶️ Начать импорт</b>\n2. Пересылайте сообщения из вашего канала боту\n3. Нажмите <b>⏹ Завершить импорт</b>\n\n<b>Команды:</b>\n/import — начать импорт\n/done — завершить импорт\n/status — статус текущего импорта\n/help — эта справка`;
        await sendTelegramMessage(botToken, telegramUserId!, helpText, getMainMenuKeyboard());
        return;
      }

      if (text === '/status') {
        const session = await queryOne<{ message_count: number; course_id: string; course_title: string }>(
          `SELECT s.message_count, s.course_id, c.title AS course_title
           FROM telegram_import_sessions s
           LEFT JOIN courses c ON c.id = s.course_id
           WHERE s.telegram_user_id = $1 AND s.is_active = true`,
          [telegramUserId]
        );
        if (!session) {
          await sendTelegramMessage(botToken, telegramUserId!, '❌ Нет активного импорта.\n\nНажмите <b>▶️ Начать импорт</b> чтобы начать.', getMainMenuKeyboard());
        } else {
          await sendTelegramMessage(botToken, telegramUserId!, `📊 <b>Статус импорта</b>\n\nКурс: <b>${session.course_title || session.course_id}</b>\nИмпортировано сообщений: <b>${session.message_count}</b>\n\nПродолжайте пересылать сообщения или нажмите <b>⏹ Завершить импорт</b>.`, getMainMenuKeyboard());
        }
        return;
      }

      if (text === '/import' || text.startsWith('/import')) {
        const bot = await queryOne<{ course_id: string; course_title: string }>(
          `SELECT b.course_id, c.title AS course_title
           FROM telegram_bots b
           LEFT JOIN courses c ON c.id = b.course_id
           WHERE b.id = $1 AND b.is_active = true`,
          [botId]
        );

        if (!bot?.course_id) {
          await sendTelegramMessage(botToken, telegramUserId!, '❌ Курс для этого бота не найден. Проверьте настройки на платформе.', getMainMenuKeyboard());
          return;
        }

        const dbUser = await queryOne<{ id: string }>(
          'SELECT id FROM users WHERE telegram_id = $1',
          [telegramUserId]
        );
        if (!dbUser) {
          await sendTelegramMessage(botToken, telegramUserId!, '❌ Ваш аккаунт Telegram не привязан к платформе.', getMainMenuKeyboard());
          return;
        }

        await query(
          `UPDATE telegram_import_sessions SET is_active = false, completed_at = NOW()
           WHERE telegram_user_id = $1 AND is_active = true`,
          [telegramUserId]
        );

        await query(
          `INSERT INTO telegram_import_sessions
             (telegram_user_id, platform_user_id, course_id, is_active)
           VALUES ($1, $2, $3, true)`,
          [telegramUserId, dbUser.id, bot.course_id]
        );

        await sendTelegramMessage(
          botToken, telegramUserId!,
          `✅ <b>Режим импорта активирован</b>\n\nКурс: <b>${bot.course_title || bot.course_id}</b>\n\nТеперь пересылайте мне сообщения из вашего приватного канала.\nКогда закончите — нажмите <b>⏹ Завершить импорт</b>`,
          getMainMenuKeyboard()
        );
        return;
      }

      if (text === '/done' || text === '/stop') {
        const session = await queryOne<{ id: string; message_count: number }>(
          `SELECT id, message_count FROM telegram_import_sessions
           WHERE telegram_user_id = $1 AND is_active = true`,
          [telegramUserId]
        );
        if (!session) {
          await sendTelegramMessage(botToken, telegramUserId!, '❌ Нет активного импорта.', getMainMenuKeyboard());
          return;
        }
        await query(
          'UPDATE telegram_import_sessions SET is_active = false, completed_at = NOW() WHERE id = $1',
          [session.id]
        );
        await sendTelegramMessage(botToken, telegramUserId!, `✅ <b>Импорт завершен!</b>\n\nИмпортировано сообщений: <b>${session.message_count}</b>`, getMainMenuKeyboard());
        return;
      }
    }

    const isForwarded = !!(message.forward_date || message.forward_origin);
    if (isPrivateChat && isForwarded) {
      const session = await queryOne<{ id: string; course_id: string; message_count: number }>(
        `SELECT id, course_id, message_count FROM telegram_import_sessions
         WHERE telegram_user_id = $1 AND is_active = true`,
        [telegramUserId]
      );
      if (!session) return;

      const courseId = session.course_id;
      const forwardTimestamp = message.forward_date || (message.forward_origin as { date?: number })?.date || message.date;
      const messageDate = new Date(forwardTimestamp * 1000).toISOString();

      if (message.media_group_id) {
        const md = extractMediaData(message);
        await query(
          `INSERT INTO telegram_media_group_buffer
             (course_id, media_group_id, telegram_message_id, media_data, caption, message_date)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            courseId, message.media_group_id, message.message_id,
            JSON.stringify(md), message.caption || null, messageDate,
          ]
        );
        scheduleMediaGroupProcessing(botToken, message.media_group_id, courseId);
      } else {
        const md = extractMediaData(message);
        const textContent = message.text || message.caption || '';

        let storagePath: string | null = null;
        let thumbnailPath: string | null = null;
        let hasError = md.has_error;
        let errorMessage = md.error_message;

        if (!hasError && md.file_id) {
          const downloaded = await downloadTelegramFileToS3(
            botToken, md.file_id, courseId, md.media_type, md.mime_type, md.file_name
          );
          if (downloaded) {
            storagePath = downloaded.storage_path;
          } else {
            hasError = true;
            errorMessage = 'Не удалось скачать файл из Telegram. Возможно файл превышает 20 MB или недоступен.';
          }
          if (md.thumbnail_file_id) {
            thumbnailPath = await downloadTelegramThumbnailToS3(botToken, md.thumbnail_file_id, courseId);
          }
        }

        await query(
          `INSERT INTO course_posts
             (course_id, source_type, title, text_content,
              media_type, storage_path, thumbnail_storage_path,
              telegram_message_id, file_size, file_name, mime_type,
              telegram_media_width, telegram_media_height, telegram_media_duration,
              has_error, error_message, published_at, order_index)
           VALUES ($1,'telegram','',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0)`,
          [
            courseId, textContent,
            md.media_type, storagePath, thumbnailPath,
            message.message_id, md.file_size, md.file_name, md.mime_type,
            md.width, md.height, md.duration,
            hasError, errorMessage, messageDate,
          ]
        );
      }

      await query(
        'UPDATE telegram_import_sessions SET message_count = $1 WHERE id = $2',
        [session.message_count + 1, session.id]
      );
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

export default router;
