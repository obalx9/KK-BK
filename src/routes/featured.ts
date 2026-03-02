import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT fc.*, c.title, c.description, c.thumbnail_url, c.price,
        s.business_name as seller_name
      FROM featured_courses fc
      JOIN courses c ON fc.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE fc.is_active = true
      ORDER BY fc.order_index ASC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get featured courses error:', error);
    res.status(500).json({ error: 'Failed to fetch featured courses' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { course_id, order_index, is_active } = req.body;

    const result = await query(`
      INSERT INTO featured_courses (course_id, order_index, is_active)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [course_id, order_index || 0, is_active !== false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create featured course error:', error);
    res.status(500).json({ error: 'Failed to create featured course' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { course_id, order_index, is_active } = req.body;

    const result = await query(`
      UPDATE featured_courses
      SET course_id = $1, order_index = $2, is_active = $3
      WHERE id = $4
      RETURNING *
    `, [course_id, order_index, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Featured course not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update featured course error:', error);
    res.status(500).json({ error: 'Failed to update featured course' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM featured_courses WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete featured course error:', error);
    res.status(500).json({ error: 'Failed to delete featured course' });
  }
});

router.put('/:id/toggle', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      UPDATE featured_courses
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Featured course not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Toggle featured course error:', error);
    res.status(500).json({ error: 'Failed to toggle featured course' });
  }
});

router.put('/:id/reorder', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { newOrderIndex, oldOrderIndex } = req.body;

    await query('BEGIN');

    if (newOrderIndex > oldOrderIndex) {
      await query(`
        UPDATE featured_courses
        SET order_index = order_index - 1
        WHERE order_index > $1 AND order_index <= $2
      `, [oldOrderIndex, newOrderIndex]);
    } else {
      await query(`
        UPDATE featured_courses
        SET order_index = order_index + 1
        WHERE order_index >= $1 AND order_index < $2
      `, [newOrderIndex, oldOrderIndex]);
    }

    const result = await query(`
      UPDATE featured_courses
      SET order_index = $1
      WHERE id = $2
      RETURNING *
    `, [newOrderIndex, id]);

    await query('COMMIT');

    res.json(result.rows[0]);
  } catch (error) {
    await query('ROLLBACK');
    logger.error('Reorder featured course error:', error);
    res.status(500).json({ error: 'Failed to reorder featured course' });
  }
});

export default router;
