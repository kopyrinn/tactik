import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../../db';
import { getUserFromSession } from '../../redis';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Extend Request type to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Get token from cookie or header
    const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    // Verify token is still present in server-side session storage.
    const sessionUserId = await getUserFromSession(token);
    if (!sessionUserId || sessionUserId !== decoded.userId) {
      return res.status(401).json({
        success: false,
        error: 'Session expired',
      });
    }

    // Ensure user still exists
    const user = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = $1', [decoded.userId]);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      });
    }

    // Add userId to request
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
  }
}
