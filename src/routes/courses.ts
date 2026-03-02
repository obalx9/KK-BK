import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    const result = await query(`
      SELECT c.*, s.business_name as seller_name,
        CASE
          WHEN c.seller_id IN (SELECT seller_id FROM sellers WHERE user_id = $1) THEN true
          ELSE false
        END as is_owner
      FROM courses c
      LEFT JOIN sellers s ON c.seller_id = s.id
      WHERE c.is_published = true OR c.seller_id IN (
        SELECT seller_id FROM sellers WHERE user_id = $1
      )
      ORDER BY c.created_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const result = await query(`
      SELECT c.*, s.business_name as seller_name, s.user_id as seller_user_id,
        CASE
          WHEN s.user_id = $2 THEN true
          ELSE false
        END as is_owner
      FROM courses c
      LEFT JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get course error:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { title, description, price, thumbnail_url, is_published } = req.body;

    const sellerResult = await query(
      'SELECT id FROM sellers WHERE user_id = $1',
      [userId]
    );

    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Only sellers can create courses' });
    }

    const sellerId = sellerResult.rows[0].id;

    const result = await query(`
      INSERT INTO courses (seller_id, title, description, price, thumbnail_url, is_published)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [sellerId, title, description || '', price || 0, thumbnail_url, is_published || false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create course error:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const updates = req.body;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to update this course' });
    }

    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (['title', 'description', 'price', 'thumbnail_url', 'is_published', 'is_active', 'display_settings', 'theme_config', 'watermark_enabled', 'watermark_text', 'telegram_chat_id'].includes(key)) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    values.push(id);

    const result = await query(`
      UPDATE courses
      SET ${fields.join(', ')}
      WHERE id = $${paramCount + 1}
      RETURNING *
    `, values);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update course error:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this course' });
    }

    await query('DELETE FROM courses WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete course error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

router.get('/:id/telegram-bot', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await query(`
      SELECT * FROM telegram_bots WHERE course_id = $1
    `, [id]);

    res.json(result.rows[0] || null);
  } catch (error) {
    logger.error('Get telegram bot error:', error);
    res.status(500).json({ error: 'Failed to fetch telegram bot' });
  }
});

export default router;
