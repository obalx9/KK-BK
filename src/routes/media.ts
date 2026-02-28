import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { uploadToS3, getS3Object, getS3ObjectMeta } from '../s3';
import { query, queryOne } from '../db';
import { requireAuth, AuthRequest } from '../auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const map: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

async function checkCourseAccess(userId: string, courseId: string): Promise<boolean> {
  const enrollment = await queryOne(
    'SELECT id FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
    [courseId, userId]
  );
  if (enrollment) return true;

  const sellerAccess = await queryOne(
    `SELECT c.id FROM courses c
     JOIN sellers s ON s.id = c.seller_id
     WHERE c.id = $1 AND s.user_id = $2`,
    [courseId, userId]
  );
  return !!sellerAccess;
}

router.get('/:fileId(*)', async (req: Request, res: Response) => {
  try {
    const fileId = decodeURIComponent(req.params.fileId);
    const courseId = req.query.course_id as string;
    const accessToken = req.query.access_token as string || req.query.token as string;

    if (!fileId) {
      res.status(400).json({ error: 'file_id is required' });
      return;
    }

    if (accessToken) {
      const tokenData = await queryOne<{ course_id: string; expires_at: string }>(
        `SELECT course_id, expires_at FROM media_access_tokens
         WHERE token = $1 AND file_id = $2`,
        [accessToken, fileId]
      );
      if (!tokenData || new Date(tokenData.expires_at) < new Date()) {
        res.status(403).json({ error: 'Invalid or expired access token' });
        return;
      }
    } else {
      const authHeader = req.headers.authorization;
      const tokenParam = req.query.token as string;
      const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : tokenParam;

      if (!jwtToken) {
        res.status(401).json({ error: 'Authorization required' });
        return;
      }

      let userId: string;
      try {
        const { verifyToken } = await import('../auth');
        const payload = verifyToken(jwtToken);
        userId = payload.userId;
      } catch {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      if (courseId) {
        const hasAccess = await checkCourseAccess(userId, courseId);
        if (!hasAccess) {
          res.status(403).json({ error: 'Access denied to this course' });
          return;
        }
      }
    }

    let meta;
    try {
      meta = await getS3ObjectMeta(fileId);
    } catch (s3Error) {
      console.error('S3 metadata error:', s3Error);
      res.status(503).json({ error: 'S3 storage not configured or unavailable' });
      return;
    }

    if (!meta) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const contentType = getContentType(fileId) || meta.contentType;
    const { contentLength } = meta;
    const rangeHeader = req.headers.range;

    if (rangeHeader && contentType.startsWith('video/')) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;
      const chunkSize = end - start + 1;

      let obj;
      try {
        obj = await getS3Object(fileId);
      } catch (s3Error) {
        console.error('S3 get error:', s3Error);
        res.status(503).json({ error: 'S3 storage not configured or unavailable' });
        return;
      }

      if (!obj) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      res.status(206);
      res.set({
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${contentLength}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Cache-Control': 'public, max-age=86400',
      });
      obj.body.pipe(res);
      return;
    }

    let obj;
    try {
      obj = await getS3Object(fileId);
    } catch (s3Error) {
      console.error('S3 get error:', s3Error);
      res.status(503).json({ error: 'S3 storage not configured or unavailable' });
      return;
    }

    if (!obj) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.set({
      'Content-Type': contentType,
      'Content-Length': contentLength.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });
    obj.body.pipe(res);
  } catch (err) {
    console.error('Media serve error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/upload', requireAuth, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    const courseId = req.body.course_id;
    const lessonId = req.body.lesson_id;

    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    if (!courseId) {
      res.status(400).json({ error: 'course_id is required' });
      return;
    }

    const hasAccess = await checkCourseAccess(req.userId!, courseId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Access denied to this course' });
      return;
    }

    const ext = path.extname(file.originalname) || '';
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const s3Key = lessonId
      ? `${courseId}/${lessonId}/${baseName}`
      : `${courseId}/${baseName}`;

    try {
      await uploadToS3(s3Key, file.buffer, file.mimetype);
    } catch (s3Error) {
      console.error('S3 upload error:', s3Error);
      res.status(503).json({ error: 'S3 storage not configured or unavailable' });
      return;
    }

    res.json({ storage_path: s3Key, file_size: file.size, file_name: file.originalname });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/token', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { file_id, course_id } = req.body;
    if (!file_id || !course_id) {
      res.status(400).json({ error: 'file_id and course_id are required' });
      return;
    }

    const hasAccess = await checkCourseAccess(req.userId!, course_id);
    if (!hasAccess) {
      res.status(403).json({ error: 'Access denied to this course' });
      return;
    }

    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await query(
      `INSERT INTO media_access_tokens (user_id, course_id, file_id, token, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.userId, course_id, file_id, token, expiresAt.toISOString()]
    );

    res.json({ access_token: token, expires_at: expiresAt.toISOString() });
  } catch (err) {
    console.error('Token generation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
