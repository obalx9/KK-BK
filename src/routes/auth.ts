import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query, queryOne } from '../db';
import { signToken, requireAuth, AuthRequest, getUserRoles } from '../auth';

const router = Router();

router.get('/telegram-bot-config', async (_req: Request, res: Response) => {
  try {
    const mainBot = await queryOne<{ bot_username: string }>(
      'SELECT bot_username FROM telegram_main_bot WHERE is_active = true LIMIT 1'
    );

    if (mainBot?.bot_username) {
      res.json({ bot_username: mainBot.bot_username });
      return;
    }

    const fallbackBot = await queryOne<{ bot_username: string }>(
      'SELECT bot_username FROM telegram_bots LIMIT 1'
    );

    if (fallbackBot?.bot_username) {
      res.json({ bot_username: fallbackBot.bot_username });
      return;
    }

    res.status(404).json({ error: 'No Telegram bot configured' });
  } catch (err) {
    console.error('Error loading bot config:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function verifyTelegramAuth(data: Record<string, unknown>, botToken: string): boolean {
  const { hash, ...authData } = data;
  if (typeof hash !== 'string') return false;

  const dataCheckString = Object.keys(authData)
    .sort()
    .map((key) => `${key}=${authData[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return hmac === hash;
}

function generateUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

router.post('/telegram', async (req: Request, res: Response) => {
  try {
    const authData = req.body as Record<string, unknown>;

    const mainBot = await queryOne<{ bot_token: string }>(
      'SELECT bot_token FROM telegram_main_bot WHERE is_active = true LIMIT 1'
    );

    let botToken = mainBot?.bot_token;
    if (!botToken) {
      const fallback = await queryOne<{ bot_token: string }>(
        'SELECT bot_token FROM telegram_bots LIMIT 1'
      );
      botToken = fallback?.bot_token;
    }

    if (!botToken) {
      res.status(500).json({ error: 'Telegram bot not configured' });
      return;
    }

    if (!verifyTelegramAuth(authData, botToken)) {
      res.status(401).json({ error: 'Invalid Telegram authentication' });
      return;
    }

    const authDate = Number(authData.auth_date);
    if (Date.now() / 1000 - authDate > 86400) {
      res.status(401).json({ error: 'Authentication data is too old' });
      return;
    }

    const telegramId = Number(authData.id);
    const existingUser = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE telegram_id = $1',
      [telegramId]
    );

    let userId: string;

    if (existingUser) {
      await query(
        `UPDATE users SET
           telegram_username = $2, first_name = $3, last_name = $4, photo_url = $5
         WHERE id = $1`,
        [
          existingUser.id,
          authData.username || null,
          authData.first_name || null,
          authData.last_name || null,
          authData.photo_url || null,
        ]
      );
      userId = existingUser.id;
    } else {
      const newUser = await queryOne<{ id: string }>(
        `INSERT INTO users (telegram_id, telegram_username, first_name, last_name, photo_url)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [
          telegramId,
          authData.username || null,
          authData.first_name || null,
          authData.last_name || null,
          authData.photo_url || null,
        ]
      );
      if (!newUser) throw new Error('Failed to create user');
      userId = newUser.id;

      await query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2)',
        [userId, 'student']
      );
    }

    const pendingEnrollments = await query<{
      id: string; course_id: string; granted_by: string; expires_at: string | null;
    }>(
      `SELECT * FROM pending_enrollments
       WHERE telegram_id = $1 OR telegram_username = $2`,
      [telegramId, String(authData.username || '').replace(/[^a-zA-Z0-9_]/g, '')]
    );

    for (const pending of pendingEnrollments) {
      await query(
        `INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [pending.course_id, userId, pending.granted_by, pending.expires_at]
      );
      await query('DELETE FROM pending_enrollments WHERE id = $1', [pending.id]);
    }

    const roles = await getUserRoles(userId);
    const token = signToken({ userId, roles });

    res.json({ token, user_id: userId, roles });
  } catch (err) {
    console.error('Telegram auth error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{
      id: string; user_id: string | null; telegram_id: number | null;
      telegram_username: string | null; first_name: string | null;
      last_name: string | null; photo_url: string | null;
      email: string | null; oauth_provider: string | null;
    }>('SELECT * FROM users WHERE id = $1', [req.userId]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const roles = await getUserRoles(req.userId!);

    res.json({ user: { ...user, roles } });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/oauth', async (req: Request, res: Response) => {
  const provider = req.query.provider as string;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;

  if (provider === 'yandex') {
    const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
    if (!YANDEX_CLIENT_ID) {
      res.status(500).json({ error: 'Yandex OAuth not configured' });
      return;
    }
    const redirectUri = encodeURIComponent(`${backendUrl}/api/auth/oauth/callback?provider=yandex`);
    res.redirect(`https://oauth.yandex.ru/authorize?client_id=${YANDEX_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}`);
    return;
  }

  res.status(400).json({ error: 'Invalid provider' });
});

router.post('/oauth/pkce', async (req: Request, res: Response) => {
  try {
    const { code_verifier, state, redirect_url } = req.body;
    if (!code_verifier || !state) {
      res.status(400).json({ error: 'code_verifier and state are required' });
      return;
    }
    await query(
      `INSERT INTO pkce_sessions (state, code_verifier, redirect_url)
       VALUES ($1, $2, $3)`,
      [state, code_verifier, redirect_url || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PKCE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/oauth/callback', async (req: Request, res: Response) => {
  const provider = req.query.provider as string;
  const code = req.query.code as string;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;

  try {
    if (provider === 'vk') {
      const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
      const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;

      if (!VK_CLIENT_ID || !VK_CLIENT_SECRET || !code) {
        res.redirect(`${appUrl}/login?error=VK OAuth not configured`);
        return;
      }

      const stateParam = req.query.state as string || '';
      const deviceId = req.query.device_id as string || '';
      const redirectUri = `${backendUrl}/api/auth/oauth/callback?provider=vk`;

      const pkceSession = await queryOne<{ code_verifier: string }>(
        `SELECT code_verifier FROM pkce_sessions
         WHERE state = $1 AND expires_at > NOW()`,
        [stateParam]
      );

      if (!pkceSession) {
        res.redirect(`${appUrl}/login?error=Session expired or invalid. Please try again.`);
        return;
      }

      await query('DELETE FROM pkce_sessions WHERE state = $1', [stateParam]);

      const tokenRes = await fetch('https://id.vk.ru/oauth2/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: pkceSession.code_verifier,
          client_id: VK_CLIENT_ID,
          client_secret: VK_CLIENT_SECRET,
          device_id: deviceId,
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'VK OAuth error');
      }

      const userInfoRes = await fetch('https://id.vk.ru/oauth2/user_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          access_token: tokenData.access_token,
          client_id: VK_CLIENT_ID,
        }),
      });

      const userInfoData = await userInfoRes.json() as { user?: { user_id: string; first_name: string; last_name: string; avatar?: string } };
      if (!userInfoData.user) throw new Error('Failed to get VK user info');

      const vkUser = userInfoData.user;
      const { user } = await createOrUpdateOAuthUser('vk', vkUser.user_id, {
        first_name: vkUser.first_name,
        last_name: vkUser.last_name,
        photo_url: vkUser.avatar || null,
      });

      res.redirect(`${appUrl}/role-select?user_id=${user.user_id}`);
      return;
    }

    if (provider === 'yandex') {
      const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
      const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET;

      if (!YANDEX_CLIENT_ID || !YANDEX_CLIENT_SECRET || !code) {
        res.redirect(`${appUrl}/login?error=Yandex OAuth not configured`);
        return;
      }

      const redirectUri = `${backendUrl}/api/auth/oauth/callback?provider=yandex`;

      const tokenRes = await fetch('https://oauth.yandex.ru/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: YANDEX_CLIENT_ID,
          client_secret: YANDEX_CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error || 'Yandex OAuth error');
      }

      const userInfoRes = await fetch('https://login.yandex.ru/info', {
        headers: { Authorization: `OAuth ${tokenData.access_token}` },
      });

      const userInfo = await userInfoRes.json() as {
        id?: string; first_name?: string; last_name?: string;
        default_email?: string; emails?: string[]; error?: string;
      };
      if (userInfo.error || !userInfo.id) throw new Error(userInfo.error || 'Failed to get Yandex user info');

      const { user } = await createOrUpdateOAuthUser('yandex', userInfo.id, {
        first_name: userInfo.first_name || '',
        last_name: userInfo.last_name || null,
        email: userInfo.default_email || (userInfo.emails?.[0]) || null,
      });

      res.redirect(`${appUrl}/role-select?user_id=${user.user_id}`);
      return;
    }

    res.status(400).json({ error: 'Invalid provider' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'OAuth error';
    console.error('OAuth callback error:', err);
    res.redirect(`${appUrl}/login?error=${encodeURIComponent(message)}`);
  }
});

router.post('/oauth/session', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }

    const user = await queryOne<{ id: string; user_id: string | null }>(
      'SELECT id, user_id FROM users WHERE user_id = $1',
      [user_id]
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const roles = await getUserRoles(user.id);
    const token = signToken({ userId: user.id, roles });

    res.json({ token, roles });
  } catch (err) {
    console.error('OAuth session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function createOrUpdateOAuthUser(
  provider: string,
  providerId: string,
  userData: { first_name: string; last_name?: string | null; photo_url?: string | null; email?: string | null }
): Promise<{ user: { id: string; user_id: string } }> {
  const existing = await queryOne<{ id: string; user_id: string | null }>(
    'SELECT id, user_id FROM users WHERE oauth_provider = $1 AND oauth_id = $2',
    [provider, providerId.toString()]
  );

  if (existing) {
    if (userData.email) {
      await query('UPDATE users SET email = $1 WHERE id = $2', [userData.email, existing.id]);
    }
    return { user: { id: existing.id, user_id: existing.user_id || existing.id } };
  }

  const newUserId = generateUserId();
  const newUser = await queryOne<{ id: string; user_id: string }>(
    `INSERT INTO users
       (user_id, oauth_provider, oauth_id, telegram_id, first_name, last_name, photo_url, email)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7)
     RETURNING id, user_id`,
    [
      newUserId, provider, providerId.toString(),
      userData.first_name, userData.last_name || null,
      userData.photo_url || null, userData.email || null,
    ]
  );

  if (!newUser) throw new Error('Failed to create user');

  await query(
    'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [newUser.id, 'student']
  );

  return { user: newUser };
}

export default router;
