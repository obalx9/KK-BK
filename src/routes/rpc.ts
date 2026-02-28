import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticateToken } from '../auth';

const router = Router();

router.post('/:functionName', authenticateToken, async (req: Request, res: Response) => {
  const { functionName } = req.params;
  const params = req.body || {};

  try {
    const paramKeys = Object.keys(params);
    const paramValues = paramKeys.map(key => params[key]);

    const paramPlaceholders = paramKeys.map((key, idx) => `${key} := $${idx + 1}`).join(', ');

    const query = paramKeys.length > 0
      ? `SELECT * FROM ${functionName}(${paramPlaceholders})`
      : `SELECT * FROM ${functionName}()`;

    const result = await pool.query(query, paramValues);

    if (result.rows.length === 1 && result.rows[0][functionName]) {
      res.json(result.rows[0][functionName]);
    } else {
      res.json(result.rows);
    }
  } catch (error) {
    console.error(`RPC function ${functionName} error:`, error);
    res.status(500).json({ error: 'RPC function call failed' });
  }
});

export default router;
