import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/course/:courseId', async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const result = await query(`
      SELECT p.*,
        json_agg(
          json_build_object(
            'id', pm.id,
            'media_type', pm.media_type,
            'file_path', pm.file_path,
            'thumbnail_path', pm.thumbnail_path,
            'file_size', pm.file_size,
            'duration', pm.duration,
            'width', pm.width,
            'height', pm.height,
            'media_group_id', pm.media_group_id,
            'order_index', pm.order_index
          ) ORDER BY pm.order_index
        ) FILTER (WHERE pm.id IS NOT NULL) as media
      FROM course_posts p
      LEFT JOIN course_post_media pm ON p.id = pm.post_id
      WHERE p.course_id = $1
      GROUP BY p.id
      ORDER BY p.message_date DESC
      LIMIT $2 OFFSET $3
    `, [courseId, limit, offset]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT p.*,
        json_agg(
          json_build_object(
            'id', pm.id,
            'media_type', pm.media_type,
            'file_path', pm.file_path,
            'thumbnail_path', pm.thumbnail_path,
            'file_size', pm.file_size,
            'duration', pm.duration,
            'width', pm.width,
            'height', pm.height,
            'media_group_id', pm.media_group_id,
            'order_index', pm.order_index
          ) ORDER BY pm.order_index
        ) FILTER (WHERE pm.id IS NOT NULL) as media
      FROM course_posts p
      LEFT JOIN course_post_media pm ON p.id = pm.post_id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { course_id, text_content, message_date, is_pinned } = req.body;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [course_id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to post to this course' });
    }

    const result = await query(`
      INSERT INTO course_posts (course_id, text_content, message_date, is_pinned)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [course_id, text_content || '', message_date || new Date().toISOString(), is_pinned || false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { text_content, is_pinned } = req.body;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to update this post' });
    }

    const result = await query(`
      UPDATE course_posts
      SET text_content = COALESCE($1, text_content),
          is_pinned = COALESCE($2, is_pinned)
      WHERE id = $3
      RETURNING *
    `, [text_content, is_pinned, id]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update post error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await query('DELETE FROM course_posts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

router.get('/:id/media', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT * FROM course_post_media
      WHERE post_id = $1
      ORDER BY order_index
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get post media error:', error);
    res.status(500).json({ error: 'Failed to fetch post media' });
  }
});

router.post('/:id/media', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const mediaItems = req.body;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const insertedMedia = [];
    for (const item of mediaItems) {
      const result = await query(`
        INSERT INTO course_post_media (
          post_id, media_type, file_path, thumbnail_path,
          file_size, duration, width, height,
          media_group_id, order_index
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        id,
        item.media_type,
        item.file_path,
        item.thumbnail_path,
        item.file_size,
        item.duration,
        item.width,
        item.height,
        item.media_group_id,
        item.order_index
      ]);
      insertedMedia.push(result.rows[0]);
    }

    res.status(201).json(insertedMedia);
  } catch (error) {
    logger.error('Add post media error:', error);
    res.status(500).json({ error: 'Failed to add post media' });
  }
});

router.delete('/media/:mediaId', async (req: AuthRequest, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT pm.id FROM course_post_media pm
      JOIN course_posts p ON pm.post_id = p.id
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE pm.id = $1 AND s.user_id = $2
    `, [mediaId, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query('DELETE FROM course_post_media WHERE id = $1', [mediaId]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete media error:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

router.get('/pinned/:courseId/:studentId', async (req: AuthRequest, res) => {
  try {
    const { courseId, studentId } = req.params;

    const result = await query(`
      SELECT spp.*, p.text_content, p.message_date
      FROM student_pinned_posts spp
      JOIN course_posts p ON spp.post_id = p.id
      WHERE spp.course_id = $1 AND spp.student_id = $2
      ORDER BY spp.created_at DESC
    `, [courseId, studentId]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get pinned posts error:', error);
    res.status(500).json({ error: 'Failed to fetch pinned posts' });
  }
});

router.post('/pinned', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { course_id, post_id } = req.body;

    const studentResult = await query(
      'SELECT id FROM users WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const studentId = studentResult.rows[0].id;

    const result = await query(`
      INSERT INTO student_pinned_posts (student_id, course_id, post_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (student_id, post_id) DO NOTHING
      RETURNING *
    `, [studentId, course_id, post_id]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Pin post error:', error);
    res.status(500).json({ error: 'Failed to pin post' });
  }
});

router.delete('/pinned/:postId', async (req: AuthRequest, res) => {
  try {
    const { postId } = req.params;
    const userId = req.userId;

    const studentResult = await query(
      'SELECT id FROM users WHERE user_id = $1',
      [userId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const studentId = studentResult.rows[0].id;

    await query(`
      DELETE FROM student_pinned_posts
      WHERE post_id = $1 AND student_id = $2
    `, [postId, studentId]);

    res.json({ success: true });
  } catch (error) {
    logger.error('Unpin post error:', error);
    res.status(500).json({ error: 'Failed to unpin post' });
  }
});

export default router;
