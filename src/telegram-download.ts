import fetch from 'node-fetch';
import { uploadToS3 } from './s3';

const TELEGRAM_MAX_FILE_SIZE = 20 * 1024 * 1024;

interface MediaExtraction {
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
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: { id: number };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  video?: { file_id: string; file_unique_id: string; width: number; height: number; duration: number; thumbnail?: { file_id: string }; mime_type?: string; file_size?: number };
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  audio?: { file_id: string; file_unique_id: string; duration: number; mime_type?: string; file_size?: number; file_name?: string };
  animation?: { file_id: string; file_unique_id: string; width: number; height: number; duration: number; thumbnail?: { file_id: string }; mime_type?: string; file_size?: number };
  voice?: { file_id: string; file_unique_id: string; duration: number; mime_type?: string; file_size?: number };
  forward_date?: number;
  forward_origin?: { type: string; date: number; chat?: { id: number; type: string }; message_id?: number; sender_user?: { id: number } };
  media_group_id?: string;
}

export function extractMediaData(message: TelegramMessage): MediaExtraction {
  let mediaType: string | null = null;
  let fileId: string | null = null;
  let fileSize: number | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;
  let thumbnailFileId: string | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  if (message.photo) {
    mediaType = 'image';
    const largestPhoto = message.photo.reduce((prev, current) =>
      (current.file_size || 0) > (prev.file_size || 0) ? current : prev
    );
    fileId = largestPhoto.file_id;
    fileSize = largestPhoto.file_size || null;
    width = largestPhoto.width;
    height = largestPhoto.height;
  } else if (message.video) {
    mediaType = 'video';
    fileId = message.video.file_id;
    fileSize = message.video.file_size || null;
    fileName = 'video';
    mimeType = message.video.mime_type || null;
    width = message.video.width;
    height = message.video.height;
    duration = message.video.duration;
    thumbnailFileId = message.video.thumbnail?.file_id || null;

    if (fileSize && fileSize > TELEGRAM_MAX_FILE_SIZE) {
      hasError = true;
      errorMessage = `Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(2)} MB). Telegram Bot API не позволяет скачивать файлы больше 20 MB. Загрузите видео вручную через сайт.`;
      fileId = null;
      thumbnailFileId = null;
    }
  } else if (message.document) {
    mediaType = 'document';
    fileSize = message.document.file_size || null;
    fileName = message.document.file_name || null;
    mimeType = message.document.mime_type || null;

    if (fileSize && fileSize > TELEGRAM_MAX_FILE_SIZE) {
      hasError = true;
      errorMessage = `Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(2)} MB). Telegram Bot API не позволяет скачивать файлы больше 20 MB. Загрузите файл вручную через сайт.`;
      fileId = null;
    } else {
      fileId = message.document.file_id;
    }
  } else if (message.audio) {
    mediaType = 'audio';
    fileId = message.audio.file_id;
    fileSize = message.audio.file_size || null;
    fileName = message.audio.file_name || null;
    mimeType = message.audio.mime_type || null;
    duration = message.audio.duration;
  } else if (message.animation) {
    mediaType = 'animation';
    fileId = message.animation.file_id;
    fileSize = message.animation.file_size || null;
    mimeType = message.animation.mime_type || null;
    width = message.animation.width;
    height = message.animation.height;
    duration = message.animation.duration;
    thumbnailFileId = message.animation.thumbnail?.file_id || null;
  } else if (message.voice) {
    mediaType = 'voice';
    fileId = message.voice.file_id;
    fileSize = message.voice.file_size || null;
    mimeType = message.voice.mime_type || null;
    duration = message.voice.duration;
    fileName = 'voice_message';
  }

  return {
    media_type: mediaType,
    file_id: fileId,
    file_size: fileSize,
    file_name: fileName,
    mime_type: mimeType,
    width,
    height,
    duration,
    thumbnail_file_id: thumbnailFileId,
    has_error: hasError,
    error_message: errorMessage,
  };
}

export async function getTelegramFilePath(botToken: string, fileId: string): Promise<string | null> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const data = await res.json() as { ok: boolean; result?: { file_path?: string; file_size?: number } };
  if (data.ok && data.result?.file_path) {
    return data.result.file_path;
  }
  return null;
}

function guessExtension(mimeType: string | null, fileName: string | null, mediaType: string | null): string {
  if (fileName) {
    const ext = fileName.split('.').pop();
    if (ext && ext.length <= 5) return ext;
  }
  if (mimeType) {
    const map: Record<string, string> = {
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
      'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
      'application/pdf': 'pdf',
    };
    if (map[mimeType]) return map[mimeType];
  }
  if (mediaType === 'image') return 'jpg';
  if (mediaType === 'video') return 'mp4';
  if (mediaType === 'audio') return 'mp3';
  if (mediaType === 'voice') return 'ogg';
  if (mediaType === 'animation') return 'mp4';
  if (mediaType === 'document') return 'bin';
  return 'bin';
}

export interface DownloadResult {
  storage_path: string;
  mime_type: string;
  file_size: number;
}

export async function downloadTelegramFileToS3(
  botToken: string,
  fileId: string,
  courseId: string,
  mediaType: string | null,
  mimeType: string | null,
  fileName: string | null
): Promise<DownloadResult | null> {
  try {
    const filePath = await getTelegramFilePath(botToken, fileId);
    if (!filePath) return null;

    const telegramUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const response = await fetch(telegramUrl);

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = guessExtension(mimeType, fileName, mediaType);
    const detectedMime = mimeType || getMimeFromExt(ext);

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const s3Key = `${courseId}/telegram/${timestamp}_${randomSuffix}.${ext}`;

    await uploadToS3(s3Key, buffer, detectedMime);

    return {
      storage_path: s3Key,
      mime_type: detectedMime,
      file_size: buffer.length,
    };
  } catch (err) {
    console.error('Error downloading Telegram file to S3:', err);
    return null;
  }
}

export async function downloadTelegramThumbnailToS3(
  botToken: string,
  thumbFileId: string,
  courseId: string
): Promise<string | null> {
  try {
    const filePath = await getTelegramFilePath(botToken, thumbFileId);
    if (!filePath) return null;

    const telegramUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const response = await fetch(telegramUrl);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const s3Key = `${courseId}/thumbnails/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    await uploadToS3(s3Key, buffer, 'image/jpeg');
    return s3Key;
  } catch {
    return null;
  }
}

function getMimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    pdf: 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

export { TelegramMessage };
