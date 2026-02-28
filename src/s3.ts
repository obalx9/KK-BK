import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

let s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3) {
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;

    if (!accessKey || !secretKey) {
      throw new Error('S3 credentials not configured');
    }

    s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'https://s3.twcstorage.ru',
      region: process.env.S3_REGION || 'ru-1',
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }
  return s3;
}

const BUCKET = process.env.S3_BUCKET || '';

export async function uploadToS3(
  key: string,
  body: Buffer | Readable,
  contentType: string
): Promise<string> {
  const client = getS3Client();
  await client.send(
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
    const client = getS3Client();
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
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
    const client = getS3Client();
    const res = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
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
