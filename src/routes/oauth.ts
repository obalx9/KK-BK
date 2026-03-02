import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

const router = express.Router();

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

interface VKUserInfo {
  user: {
    user_id: string;
    first_name: string;
    last_name: string;
    avatar?: string;
  };
}

interface YandexUserInfo {
  id: string;
  first_name: string;
  last_name: string;
  default_email?: string;
  emails?: string[];
}

function generateUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createOrUpdateUser(
  pool: Pool,
  provider: string,
  providerId: string,
  userData: {
    first_name: string;
    last_name?: string;
    photo_url?: string;
    email?: string;
  }
) {
  const existingResult = await pool.query(
    `SELECT id, user_id FROM users
     WHERE oauth_provider = $1 AND oauth_id = $2`,
    [provider, providerId.toString()]
  );

  if (existingResult.rows.length > 0) {
    const user = existingResult.rows[0];
    if (userData.email) {
      await pool.query(
        'UPDATE users SET email = $1 WHERE id = $2',
        [userData.email, user.id]
      );
    }
    return user;
  }

  const newUserId = generateUserId();

  const insertResult = await pool.query(
    `INSERT INTO users (
      user_id, oauth_provider, oauth_id, telegram_id,
      first_name, last_name, photo_url, email
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, user_id`,
    [
      newUserId,
      provider,
      providerId.toString(),
      null,
      userData.first_name,
      userData.last_name || null,
      userData.photo_url || null,
      userData.email || null
    ]
  );

  const newUser = insertResult.rows[0];

  await pool.query(
    `INSERT INTO user_roles (user_id, role)
     VALUES ($1, 'student')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [newUser.id]
  );

  return newUser;
}

// GET /api/oauth/vk - Initiate VK OAuth flow
router.get('/vk', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
    const BACKEND_URL = process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3000';
    const VK_REDIRECT_URI = `${BACKEND_URL}/api/oauth/vk/callback`;

    if (!VK_CLIENT_ID) {
      return res.status(500).json({ error: 'VK OAuth not configured' });
    }

    const state = generateState();
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    await pool.query(
      `INSERT INTO pkce_sessions (state, code_verifier)
       VALUES ($1, $2)`,
      [state, codeVerifier]
    );

    const authUrl = new URL('https://id.vk.com/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', VK_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', VK_REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'email');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('VK OAuth initiation error:', error);
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';
    res.redirect(`${APP_URL}/login?error=VK OAuth initiation failed`);
  }
});

// GET /api/oauth/yandex - Initiate Yandex OAuth flow
router.get('/yandex', async (req: Request, res: Response) => {
  try {
    const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
    const BACKEND_URL = process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3000';
    const YANDEX_REDIRECT_URI = `${BACKEND_URL}/api/oauth/yandex/callback`;

    if (!YANDEX_CLIENT_ID) {
      return res.status(500).json({ error: 'Yandex OAuth not configured' });
    }

    const authUrl = new URL('https://oauth.yandex.ru/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', YANDEX_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', YANDEX_REDIRECT_URI);

    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('Yandex OAuth initiation error:', error);
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';
    res.redirect(`${APP_URL}/login?error=Yandex OAuth initiation failed`);
  }
});

// POST /api/oauth/pkce-session - Store PKCE session
router.post('/pkce-session', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { state, code_verifier, redirect_url } = req.body;

    if (!state || !code_verifier) {
      return res.status(400).json({ error: 'state and code_verifier are required' });
    }

    await pool.query(
      `INSERT INTO pkce_sessions (state, code_verifier, redirect_url)
       VALUES ($1, $2, $3)`,
      [state, code_verifier, redirect_url || null]
    );

    res.json({ ok: true });
  } catch (error) {
    logger.error('PKCE session error:', error);
    res.status(500).json({ error: 'Failed to store PKCE session' });
  }
});

// GET /api/oauth/vk/callback - VK OAuth callback
router.get('/vk/callback', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { code, state, device_id } = req.query;
    const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
    const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';

    if (!VK_CLIENT_ID || !VK_CLIENT_SECRET) {
      return res.redirect(`${APP_URL}/login?error=VK OAuth not configured`);
    }

    if (!code) {
      return res.redirect(`${APP_URL}/login?error=No authorization code provided`);
    }

    const pkceResult = await pool.query(
      `SELECT code_verifier, redirect_url FROM pkce_sessions
       WHERE state = $1 AND expires_at > NOW()`,
      [state || '']
    );

    if (pkceResult.rows.length === 0) {
      return res.redirect(`${APP_URL}/login?error=Session expired or invalid`);
    }

    const pkceSession = pkceResult.rows[0];

    await pool.query('DELETE FROM pkce_sessions WHERE state = $1', [state]);

    const VK_REDIRECT_URI = `${process.env.API_URL || 'http://localhost:3000'}/api/oauth/vk/callback`;

    const tokenResponse = await fetch('https://id.vk.ru/oauth2/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        code_verifier: pkceSession.code_verifier,
        client_id: VK_CLIENT_ID,
        client_secret: VK_CLIENT_SECRET,
        device_id: (device_id as string) || '',
        redirect_uri: VK_REDIRECT_URI,
      }),
    });

    const tokenData: any = await tokenResponse.json();

    if (tokenData.error) {
      logger.error('VK token error:', tokenData);
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    }

    const userInfoResponse = await fetch('https://id.vk.ru/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: tokenData.access_token,
        client_id: VK_CLIENT_ID,
      }),
    });

    const userInfoData: VKUserInfo = await userInfoResponse.json();

    if (!userInfoData.user) {
      return res.redirect(`${APP_URL}/login?error=Failed to get VK user info`);
    }

    const vkUser = userInfoData.user;

    const user = await createOrUpdateUser(pool, 'vk', vkUser.user_id, {
      first_name: vkUser.first_name,
      last_name: vkUser.last_name,
      photo_url: vkUser.avatar || undefined,
    });

    logger.info('VK OAuth success', { user_id: user.user_id });

    const redirectUrl = pkceSession.redirect_url || `${APP_URL}/role-select`;
    const finalUrl = new URL(redirectUrl);
    finalUrl.searchParams.set('user_id', user.user_id);

    res.redirect(finalUrl.toString());
  } catch (error) {
    logger.error('VK OAuth callback error:', error);
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

// GET /api/oauth/yandex/callback - Yandex OAuth callback
router.get('/yandex/callback', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { code } = req.query;
    const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
    const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET;
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';

    if (!YANDEX_CLIENT_ID || !YANDEX_CLIENT_SECRET) {
      return res.redirect(`${APP_URL}/login?error=Yandex OAuth not configured`);
    }

    if (!code) {
      return res.redirect(`${APP_URL}/login?error=No authorization code provided`);
    }

    const YANDEX_REDIRECT_URI = `${process.env.API_URL || 'http://localhost:3000'}/api/oauth/yandex/callback`;

    const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        client_id: YANDEX_CLIENT_ID,
        client_secret: YANDEX_CLIENT_SECRET,
        redirect_uri: YANDEX_REDIRECT_URI,
      }),
    });

    const tokenData: any = await tokenResponse.json();

    if (tokenData.error) {
      logger.error('Yandex token error:', tokenData);
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent(tokenData.error)}`);
    }

    const userInfoResponse = await fetch('https://login.yandex.ru/info', {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });

    const userInfo: YandexUserInfo = await userInfoResponse.json();

    if (!userInfo.id) {
      return res.redirect(`${APP_URL}/login?error=Failed to get Yandex user info`);
    }

    const user = await createOrUpdateUser(pool, 'yandex', userInfo.id, {
      first_name: userInfo.first_name,
      last_name: userInfo.last_name,
      email: userInfo.default_email || (userInfo.emails && userInfo.emails[0]) || undefined,
    });

    logger.info('Yandex OAuth success', { user_id: user.user_id });

    const redirectUrl = new URL('/role-select', APP_URL);
    redirectUrl.searchParams.set('user_id', user.user_id);

    res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error('Yandex OAuth callback error:', error);
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

// POST /api/oauth/vk/exchange - Exchange VK code for user (alternative)
router.post('/vk/exchange', async (req: Request, res: Response) => {
  const pool: Pool = req.app.get('db');

  try {
    const { code, code_verifier, device_id } = req.body;
    const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
    const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;

    if (!VK_CLIENT_ID || !VK_CLIENT_SECRET) {
      return res.status(500).json({ error: 'VK OAuth not configured' });
    }

    if (!code || !code_verifier) {
      return res.status(400).json({ error: 'code and code_verifier are required' });
    }

    const VK_REDIRECT_URI = `${process.env.API_URL || 'http://localhost:3000'}/api/oauth/vk/callback`;

    const tokenResponse = await fetch('https://id.vk.ru/oauth2/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier,
        client_id: VK_CLIENT_ID,
        client_secret: VK_CLIENT_SECRET,
        device_id: device_id || '',
        redirect_uri: VK_REDIRECT_URI,
      }),
    });

    const tokenData: any = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }

    const userInfoResponse = await fetch('https://id.vk.ru/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: tokenData.access_token,
        client_id: VK_CLIENT_ID,
      }),
    });

    const userInfoData: VKUserInfo = await userInfoResponse.json();

    if (!userInfoData.user) {
      return res.status(400).json({ error: 'Failed to get VK user info' });
    }

    const vkUser = userInfoData.user;

    const user = await createOrUpdateUser(pool, 'vk', vkUser.user_id, {
      first_name: vkUser.first_name,
      last_name: vkUser.last_name,
      photo_url: vkUser.avatar || undefined,
    });

    res.json({
      user_id: user.user_id,
      first_name: vkUser.first_name,
      last_name: vkUser.last_name,
    });
  } catch (error) {
    logger.error('VK exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange VK code' });
  }
});

export default router;
