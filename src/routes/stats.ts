import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/ad-view', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { ad_post_id } = req.body;

    const userResult = await query(
      'SELECT id FROM users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await query(`
      INSERT INTO ad_post_stats (ad_post_id, user_id, viewed_at)
      VALUES ($1, $2, NOW())
      RETURNING *
    `, [ad_post_id, userResult.rows[0].id]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Record ad view error:', error);
    res.status(500).json({ error: 'Failed to record ad view' });
  }
});

export default router;
