/**
 * Скрипт миграции медиа-файлов из Telegram в S3
 *
 * Использование:
 *   npx ts-node scripts/migrate-media.ts
 *
 * Скрипт пройдёт по всем постам с telegram_file_id, скачает файлы из Telegram и
 * загрузит их в S3, обновив storage_path в базе данных.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import {
  downloadTelegramFileToS3,
  downloadTelegramThumbnailToS3,
} from '../src/telegram-download';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=disable')
    ? false
    : { rejectUnauthorized: false },
});

interface PostRow {
  id: string;
  course_id: string;
  telegram_file_id: string;
  telegram_thumbnail_file_id: string | null;
  media_type: string;
  mime_type: string | null;
  file_name: string | null;
  bot_token: string;
}

interface MediaRow {
  id: string;
  post_id: string;
  course_id: string;
  telegram_file_id: string;
  thumbnail_file_id: string | null;
  media_type: string;
  mime_type: string | null;
  file_name: string | null;
  bot_token: string;
}

async function run() {
  console.log('Starting media migration: Telegram -> S3');

  const client = await pool.connect();

  try {
    const postsResult = await client.query<PostRow>(`
      SELECT
        cp.id, cp.course_id,
        cp.telegram_file_id,
        cp.telegram_thumbnail_file_id,
        cp.media_type, cp.mime_type, cp.file_name,
        tb.bot_token
      FROM course_posts cp
      JOIN telegram_bots tb ON tb.course_id = cp.course_id
      WHERE cp.telegram_file_id IS NOT NULL
        AND cp.storage_path IS NULL
        AND cp.has_error = false
      ORDER BY cp.created_at
    `);

    console.log(`Found ${postsResult.rows.length} posts to migrate`);

    let successCount = 0;
    let errorCount = 0;

    for (const post of postsResult.rows) {
      try {
        process.stdout.write(`  Migrating post ${post.id} (${post.media_type})... `);

        const result = await downloadTelegramFileToS3(
          post.bot_token,
          post.telegram_file_id,
          post.course_id,
          post.media_type,
          post.mime_type,
          post.file_name
        );

        if (!result) {
          await client.query(
            `UPDATE course_posts SET
               has_error = true,
               error_message = 'Не удалось скачать файл при миграции (файл может быть недоступен)'
             WHERE id = $1`,
            [post.id]
          );
          process.stdout.write('SKIPPED (file unavailable)\n');
          errorCount++;
          continue;
        }

        let thumbnailPath: string | null = null;
        if (post.telegram_thumbnail_file_id) {
          thumbnailPath = await downloadTelegramThumbnailToS3(
            post.bot_token,
            post.telegram_thumbnail_file_id,
            post.course_id
          );
        }

        await client.query(
          `UPDATE course_posts SET
             storage_path = $1,
             thumbnail_storage_path = $2,
             telegram_file_id = NULL,
             telegram_thumbnail_file_id = NULL
           WHERE id = $3`,
          [result.storage_path, thumbnailPath, post.id]
        );

        process.stdout.write(`OK -> ${result.storage_path}\n`);
        successCount++;
      } catch (err) {
        process.stdout.write(`ERROR: ${err}\n`);
        errorCount++;
      }
    }

    const mediaItemsResult = await client.query<MediaRow>(`
      SELECT
        cpm.id, cpm.post_id,
        cp.course_id,
        cpm.telegram_file_id,
        cpm.thumbnail_file_id,
        cpm.media_type, cpm.mime_type, cpm.file_name,
        tb.bot_token
      FROM course_post_media cpm
      JOIN course_posts cp ON cp.id = cpm.post_id
      JOIN telegram_bots tb ON tb.course_id = cp.course_id
      WHERE cpm.telegram_file_id IS NOT NULL
        AND cpm.storage_path IS NULL
        AND cpm.has_error = false
      ORDER BY cpm.created_at
    `);

    console.log(`\nFound ${mediaItemsResult.rows.length} media group items to migrate`);

    for (const item of mediaItemsResult.rows) {
      try {
        process.stdout.write(`  Migrating media item ${item.id} (${item.media_type})... `);

        const result = await downloadTelegramFileToS3(
          item.bot_token,
          item.telegram_file_id,
          item.course_id,
          item.media_type,
          item.mime_type,
          item.file_name
        );

        if (!result) {
          await client.query(
            `UPDATE course_post_media SET
               has_error = true,
               error_message = 'Не удалось скачать файл при миграции'
             WHERE id = $1`,
            [item.id]
          );
          process.stdout.write('SKIPPED (file unavailable)\n');
          errorCount++;
          continue;
        }

        let thumbnailPath: string | null = null;
        if (item.thumbnail_file_id) {
          thumbnailPath = await downloadTelegramThumbnailToS3(
            item.bot_token,
            item.thumbnail_file_id,
            item.course_id
          );
        }

        await client.query(
          `UPDATE course_post_media SET
             storage_path = $1,
             thumbnail_storage_path = $2,
             telegram_file_id = NULL,
             thumbnail_file_id = NULL
           WHERE id = $3`,
          [result.storage_path, thumbnailPath, item.id]
        );

        process.stdout.write(`OK -> ${result.storage_path}\n`);
        successCount++;
      } catch (err) {
        process.stdout.write(`ERROR: ${err}\n`);
        errorCount++;
      }
    }

    console.log(`\nMigration complete: ${successCount} succeeded, ${errorCount} failed/skipped`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
