import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'https://s3.twcstorage.ru',
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET || '';

export async function uploadToS3(
  key: string,
  body: Buffer | Readable,
  contentType: string
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

export async function getS3Object(
  key: string
): Promise<{ body: Readable; contentType: string; contentLength: number } | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return {
      body: res.Body as Readable,
      contentType: res.ContentType || 'application/octet-stream',
      contentLength: res.ContentLength || 0,
    };
  } catch {
    return null;
  }
}

export async function getS3ObjectMeta(key: string): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return {
      contentLength: res.ContentLength || 0,
      contentType: res.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

export function getPublicUrl(key: string): string {
  const endpoint = (process.env.S3_ENDPOINT || 'https://s3.twcstorage.ru').replace(/\/$/, '');
  return `${endpoint}/${BUCKET}/${key}`;
}
