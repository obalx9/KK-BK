import { Router, Response } from 'express';
import { queryOne } from '../db';
import { requireAuth, AuthRequest } from '../auth';

const router = Router();

router.get('/check', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const seller = await queryOne(
      'SELECT id FROM sellers WHERE user_id = $1',
      [req.userId]
    );
    res.json({ has_seller: !!seller });
  } catch (err) {
    console.error('Seller check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
