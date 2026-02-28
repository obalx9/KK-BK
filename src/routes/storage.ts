import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken, OptionalAuthRequest } from '../auth';
import { uploadToS3, deleteFromS3, getFileFromS3 } from '../s3';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/:bucket/upload', authenticateToken, upload.single('file'), async (req: Request, res: Response) => {
  const { bucket } = req.params;
  const { path: filePath } = req.query as { path: string };

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  if (!filePath) {
    return res.status(400).json({ error: 'Path parameter is required' });
  }

  try {
    const fullPath = `${bucket}/${filePath}`;
    await uploadToS3(fullPath, req.file.buffer, req.file.mimetype);

    res.json({
      path: filePath,
      fullPath,
      bucket
    });
  } catch (error) {
    console.error('Storage upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

router.delete('/:bucket/files', authenticateToken, async (req: Request, res: Response) => {
  const { bucket } = req.params;
  const { paths } = req.body as { paths: string[] };

  if (!paths || !Array.isArray(paths)) {
    return res.status(400).json({ error: 'Paths array is required' });
  }

  try {
    const fullPaths = paths.map(p => `${bucket}/${p}`);
    await Promise.all(fullPaths.map(p => deleteFromS3(p)));

    res.json({ success: true });
  } catch (error) {
    console.error('Storage delete error:', error);
    res.status(500).json({ error: 'File deletion failed' });
  }
});

router.get('/:bucket/*', async (req: OptionalAuthRequest, res: Response) => {
  const { bucket } = req.params;
  const filePath = req.params[0];

  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }

  try {
    const fullPath = `${bucket}/${filePath}`;
    const { data, contentType } = await getFileFromS3(fullPath);

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(data);
  } catch (error) {
    console.error('Storage get error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

router.post('/:bucket/sign', authenticateToken, async (req: Request, res: Response) => {
  const { bucket } = req.params;
  const { path: filePath, expiresIn } = req.body as { path: string; expiresIn: number };

  if (!filePath) {
    return res.status(400).json({ error: 'Path is required' });
  }

  try {
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    const signedUrl = `${apiUrl}/api/storage/${bucket}/${filePath}`;

    res.json({ signedUrl });
  } catch (error) {
    console.error('Storage sign error:', error);
    res.status(500).json({ error: 'URL signing failed' });
  }
});

export default router;
