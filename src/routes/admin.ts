import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.use(requireRole('super_admin'));

router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const [users, sellers, courses] = await Promise.all([
      query('SELECT COUNT(*) as count FROM users'),
      query('SELECT COUNT(*) as count FROM sellers'),
      query('SELECT COUNT(*) as count FROM courses')
    ]);

    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalSellers: parseInt(sellers.rows[0].count),
      totalCourses: parseInt(courses.rows[0].count)
    });
  } catch (error) {
    logger.error('Get admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/sellers', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT s.*, u.first_name, u.last_name, u.email, u.telegram_username,
        (SELECT COUNT(*) FROM courses WHERE seller_id = s.id) as course_count
      FROM sellers s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get sellers error:', error);
    res.status(500).json({ error: 'Failed to fetch sellers' });
  }
});

router.delete('/sellers/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM sellers WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete seller error:', error);
    res.status(500).json({ error: 'Failed to delete seller' });
  }
});

router.get('/users', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT u.*,
        array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/courses', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT c.*, s.business_name as seller_name,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id) as enrollment_count
      FROM courses c
      LEFT JOIN sellers s ON c.seller_id = s.id
      ORDER BY c.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

export default router;
