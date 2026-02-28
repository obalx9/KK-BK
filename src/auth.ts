import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { queryOne } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export interface JwtPayload {
  userId: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  userId?: string;
  userRoles?: string[];
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string);

  if (!token) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.userRoles = payload.roles;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.userRoles?.includes('super_admin')) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

export async function getUserById(userId: string) {
  return queryOne<{
    id: string;
    user_id: string | null;
    telegram_id: number | null;
    telegram_username: string | null;
    first_name: string | null;
    last_name: string | null;
    photo_url: string | null;
    email: string | null;
    oauth_provider: string | null;
    oauth_id: string | null;
  }>('SELECT * FROM users WHERE id = $1', [userId]);
}

export async function getUserRoles(userId: string): Promise<string[]> {
  const rows = await queryOne<{ roles: string[] }>(
    `SELECT array_agg(role) AS roles FROM user_roles WHERE user_id = $1`,
    [userId]
  );
  return rows?.roles || [];
}
