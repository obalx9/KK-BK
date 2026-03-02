import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM ad_posts
      WHERE is_active = true
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get ads error:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { title, description, media_type, storage_path, link_url, is_active } = req.body;

    const result = await query(`
      INSERT INTO ad_posts (title, description, media_type, storage_path, link_url, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [title, description, media_type, storage_path, link_url || null, is_active !== false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create ad error:', error);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, description, media_type, storage_path, link_url, is_active } = req.body;

    const result = await query(`
      UPDATE ad_posts
      SET title = $1, description = $2, media_type = $3,
          storage_path = $4, link_url = $5, is_active = $6
      WHERE id = $7
      RETURNING *
    `, [title, description, media_type, storage_path, link_url, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update ad error:', error);
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM ad_posts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete ad error:', error);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

export default router;
