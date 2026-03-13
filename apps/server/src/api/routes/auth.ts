import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, queryOne } from '../../db';
import {
  saveUserSession,
  deleteUserSession,
  getUserFromSession,
  addUserActiveSession,
  removeUserActiveSession,
  countUserActiveSessions,
  deleteAllUserSessions,
  deleteSessionState,
} from '../../redis';
import type { User, ApiResponse } from '../../types';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

async function deleteSessionWithArtifacts(sessionId: string) {
  query('DELETE FROM drawings WHERE session_id = $1', [sessionId]);
  query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await deleteSessionState(sessionId);
}

function getDeviceLimit(plan: string): number {
  if (plan === 'pro') return 10;
  if (plan === 'coach') return 6;
  return 2; // free
}

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string(),
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    // Check if user exists
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'User already exists',
      } as ApiResponse);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const { generateId } = require('../../db');
    const id = generateId();
    
    const db = require('../../db').getDb();
    db.prepare(`INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`).run(id, email, passwordHash, name || null);
    
    const user = db.prepare(
      `SELECT id, email, name, avatar_url, plan, coach_owner_id, subscription_status,
              subscription_end_date, created_at, updated_at
       FROM users
       WHERE id = ?`
    ).get(id) as any;

    if (!user) {
      throw new Error('Failed to create user');
    }

    // Generate JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    // Save session in Redis
    await saveUserSession(user.id, token, 604800); // 7 days

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const userData: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      plan: user.plan,
      coachOwnerId: user.coach_owner_id ?? null,
      subscriptionStatus: user.subscription_status,
      subscriptionEndDate: user.subscription_end_date,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };

    res.json({
      success: true,
      data: { user: userData },
    } as ApiResponse<{ user: User }>);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      } as ApiResponse);
    }
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register',
    } as ApiResponse);
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = loginSchema.parse(req.body);

    // Find user
    const user = await queryOne<any>(
      'SELECT * FROM users WHERE email = $1',
      [login]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Неверный логин или пароль',
      } as ApiResponse);
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'Неверный логин или пароль',
      } as ApiResponse);
    }

    // Check concurrent device limit (override takes priority over plan default)
    const activeCount = await countUserActiveSessions(user.id);
    const limit = user.max_devices_override != null ? user.max_devices_override : getDeviceLimit(user.plan || 'free');
    if (activeCount >= limit) {
      return res.status(403).json({
        success: false,
        error: `Превышен лимит активных устройств (${limit}). Выйдите с других устройств и попробуйте снова.`,
        code: 'DEVICE_LIMIT_EXCEEDED',
      } as ApiResponse);
    }

    // Generate JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    // Save session + track active device
    await saveUserSession(user.id, token, 604800);
    await addUserActiveSession(user.id, token);

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Remove password from response
    const { password_hash, ...userWithoutPassword } = user;

    const userData: User = {
      id: userWithoutPassword.id,
      email: userWithoutPassword.email,
      name: userWithoutPassword.name,
      avatarUrl: userWithoutPassword.avatar_url,
      plan: userWithoutPassword.plan,
      coachOwnerId: userWithoutPassword.coach_owner_id ?? null,
      subscriptionStatus: userWithoutPassword.subscription_status,
      subscriptionEndDate: userWithoutPassword.subscription_end_date,
      createdAt: userWithoutPassword.created_at,
      updatedAt: userWithoutPassword.updated_at,
    };

    res.json({
      success: true,
      data: { user: userData },
    } as ApiResponse<{ user: User }>);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      } as ApiResponse);
    }
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login',
    } as ApiResponse);
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      // Look up userId to remove from active sessions set
      const userId = await getUserFromSession(token);
      if (userId) {
        const currentUser = await queryOne<{ is_demo_user: number | null }>(
          'SELECT is_demo_user FROM users WHERE id = $1',
          [userId]
        );
        const isDemoUser = currentUser?.is_demo_user === 1;

        await removeUserActiveSession(userId, token);
        if (isDemoUser) {
          const ownedSessions = query<{ id: string }>(
            'SELECT id FROM sessions WHERE owner_id = $1',
            [userId]
          );
          for (const session of ownedSessions) {
            await deleteSessionWithArtifacts(session.id);
          }

          await deleteAllUserSessions(userId);
          query('DELETE FROM users WHERE id = $1', [userId]);
        }
      }
      await deleteUserSession(token);
    }

    res.clearCookie('auth_token');
    res.json({
      success: true,
      message: 'Logged out successfully',
    } as ApiResponse);
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to logout',
    } as ApiResponse);
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
      } as ApiResponse);
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    // Get user
    const user = await queryOne<any>(
      `SELECT id, email, name, avatar_url, plan, coach_owner_id, subscription_status, 
              subscription_end_date, created_at, updated_at 
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      } as ApiResponse);
    }

    const userData: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      plan: user.plan,
      coachOwnerId: user.coach_owner_id ?? null,
      subscriptionStatus: user.subscription_status,
      subscriptionEndDate: user.subscription_end_date,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };

    res.json({
      success: true,
      data: userData,
    } as ApiResponse<User>);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    } as ApiResponse);
  }
});

export default router;
