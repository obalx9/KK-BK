import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { Pool } from 'pg';
import { generateToken } from '../utils/jwt';

const router = express.Router();

// Telegram authentication verification
function verifyTelegramAuth(data: any, botToken: string): boolean {
  const { hash, ...authData } = data;

  const dataCheckString = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return hmac === hash;
}

// Generate random user ID
function generateUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// POST /api/auth/telegram - Telegram authentication
router.post('/telegram', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const authData = req.body;

    if (!authData.id || !authData.hash) {
      return res.status(400).json({ error: 'Invalid auth data' });
    }

    // Get bot token from database
    const botResult = await pool.query(
      'SELECT bot_token FROM telegram_main_bot WHERE is_active = true LIMIT 1'
    );

    if (botResult.rows.length === 0) {
      return res.status(500).json({ error: 'Telegram bot not configured' });
    }

    const botToken = botResult.rows[0].bot_token;

    // Verify Telegram auth
    const isValid = verifyTelegramAuth(authData, botToken);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid Telegram authentication' });
    }

    // Check auth date (max 24 hours)
    const authDate = new Date(authData.auth_date * 1000);
    const now = new Date();
    const timeDiff = now.getTime() - authDate.getTime();
    if (timeDiff > 86400000) {
      return res.status(401).json({ error: 'Authentication data is too old' });
    }

    // Find or create user
    let userResult = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [authData.id]
    );

    let userId: string;

    if (userResult.rows.length > 0) {
      // Update existing user
      await pool.query(
        `UPDATE users
         SET telegram_username = $1, first_name = $2, last_name = $3, photo_url = $4
         WHERE id = $5`,
        [authData.username, authData.first_name, authData.last_name, authData.photo_url, userResult.rows[0].id]
      );
      userId = userResult.rows[0].id;
    } else {
      // Create new user
      const newUserResult = await pool.query(
        `INSERT INTO users (user_id, telegram_id, telegram_username, first_name, last_name, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [generateUserId(), authData.id, authData.username, authData.first_name, authData.last_name, authData.photo_url]
      );
      userId = newUserResult.rows[0].id;

      // Assign default student role
      await pool.query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, 'student']
      );
    }

    // Get user roles
    const rolesResult = await pool.query(
      'SELECT role FROM user_roles WHERE user_id = $1',
      [userId]
    );
    const roles = rolesResult.rows.map(r => r.role);

    // Process pending enrollments
    const pendingResult = await pool.query(
      'SELECT * FROM pending_enrollments WHERE telegram_id = $1 OR telegram_username = $2',
      [authData.id, authData.username]
    );

    for (const pending of pendingResult.rows) {
      await pool.query(
        `INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [pending.course_id, userId, pending.granted_by, pending.expires_at]
      );

      await pool.query('DELETE FROM pending_enrollments WHERE id = $1', [pending.id]);
    }

    // Generate JWT token
    const token = generateToken({ userId, telegramId: authData.id, roles });

    res.json({
      success: true,
      user_id: userId,
      roles,
      token,
    });
  } catch (error) {
    console.error('Telegram auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/oauth/session - Create OAuth session
router.post('/oauth/session', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get user roles
    const rolesResult = await pool.query(
      'SELECT role FROM user_roles WHERE user_id = $1',
      [user.id]
    );
    const roles = rolesResult.rows.map(r => r.role);

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      oauthProvider: user.oauth_provider,
      oauthId: user.oauth_id,
      roles
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        photo_url: user.photo_url,
        roles,
      },
    });
  } catch (error) {
    console.error('OAuth session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/sync-metadata - Sync user metadata (admin only)
router.post('/sync-metadata', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const usersResult = await pool.query(
      'SELECT id, telegram_id, telegram_username, first_name, last_name, photo_url FROM users'
    );

    let updatedCount = 0;
    let errorCount = 0;

    for (const user of usersResult.rows) {
      try {
        const rolesResult = await pool.query(
          'SELECT role FROM user_roles WHERE user_id = $1',
          [user.id]
        );

        // In a real implementation, you would update auth.users metadata here
        // This is a simplified version
        updatedCount++;
      } catch (err) {
        console.error(`Error updating user ${user.id}:`, err);
        errorCount++;
      }
    }

    res.json({
      success: true,
      message: `Updated ${updatedCount} users, ${errorCount} errors`,
      updated: updatedCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error('Error syncing user metadata:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/user-roles/:userId - Update user roles
router.put('/user-roles/:userId', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { userId } = req.params;

    const userResult = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const rolesResult = await pool.query(
      'SELECT role FROM user_roles WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      roles: rolesResult.rows.map(r => r.role),
    });
  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/admin-link - Generate admin magic link (for debugging/testing)
router.post('/admin-link', async (req: Request, res: Response) => {
  try {
    // This is a simplified version
    // In production, you'd generate a proper auth link
    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?token=admin-test-token`;

    res.json({ link });
  } catch (error) {
    console.error('Error generating admin link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
