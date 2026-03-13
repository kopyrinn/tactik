import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { generateId, incrementDemoMetric, query, queryOne } from '../../db';
import { addUserActiveSession, saveUserSession } from '../../redis';
import {
  acquireDemoStartSlot,
  assertDemoStartRateLimit,
  DemoStartQueueOverloadError,
  DemoStartRateLimitError,
} from '../middleware/demoStartGuard';

const router = Router();

const DEMO_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const DEMO_DURATION_SECONDS = Math.floor(DEMO_DURATION_MS / 1000);
const DEMO_USER_PASSWORD = '123';
const DEMO_USER_EMAIL_SUFFIX = '@demo.local';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
let demoPasswordHashPromise: Promise<string> | null = null;

function getDemoPasswordHash() {
  if (!demoPasswordHashPromise) {
    demoPasswordHashPromise = bcrypt.hash(DEMO_USER_PASSWORD, 10);
  }
  return demoPasswordHashPromise;
}

function isUniqueConstraintError(error: unknown) {
  const message = String((error as any)?.message || '');
  return message.includes('UNIQUE') || message.includes('constraint');
}

async function allocateNextDemoLogin() {
  let counter = queryOne<{ value: number | string }>(
    'UPDATE demo_login_counter SET value = value + 1 WHERE id = 1 RETURNING value'
  );

  if (!counter) {
    query('INSERT OR IGNORE INTO demo_login_counter (id, value) VALUES (1, 0)');
    counter = queryOne<{ value: number | string }>(
      'UPDATE demo_login_counter SET value = value + 1 WHERE id = 1 RETURNING value'
    );
  }

  const value = Number(counter?.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Failed to increment demo login counter');
  }

  return `test${value}`;
}

// POST /api/demo/start - create temporary test user and authenticate immediately
router.post('/start', async (req, res) => {
  let releaseSlot: (() => void) | null = null;

  try {
    assertDemoStartRateLimit(req);
    releaseSlot = await acquireDemoStartSlot();

    let created: { login: string; email: string; userId: string; expiresAt: string } | null = null;
    const passwordHash = await getDemoPasswordHash();

    for (let attempt = 0; attempt < 2 && !created; attempt += 1) {
      const login = await allocateNextDemoLogin();
      const email = `${login}${DEMO_USER_EMAIL_SUFFIX}`;
      const userId = generateId();
      const expiresAt = new Date(Date.now() + DEMO_DURATION_MS).toISOString();

      try {
        query(
          `INSERT INTO users (
            id,
            email,
            password_hash,
            name,
            plan,
            subscription_status,
            max_devices_override,
            max_sessions_override,
            max_participants_override,
            is_demo_user,
            demo_expires_at
          )
          VALUES ($1, $2, $3, $4, 'coach', 'active', 1, 10, 3, 1, $5)`,
          [userId, email, passwordHash, `Demo ${login}`, expiresAt]
        );

        created = { login, email, userId, expiresAt };
      } catch (error: any) {
        if (isUniqueConstraintError(error) && attempt === 0) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error('Failed to allocate demo user login');
    }

    const user = await queryOne<any>(
      `SELECT id, email, name, avatar_url, plan, coach_owner_id, subscription_status,
              subscription_end_date, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [created.userId]
    );

    if (!user) {
      throw new Error('Failed to create demo user');
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: DEMO_DURATION_SECONDS });
    await saveUserSession(user.id, token, DEMO_DURATION_SECONDS);
    await addUserActiveSession(user.id, token);
    incrementDemoMetric('starts');

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: DEMO_DURATION_MS,
    });

    return res.json({
      success: true,
      data: {
        expiresAt: created.expiresAt,
        login: created.login,
        user: {
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
        },
      },
    });
  } catch (err) {
    if (err instanceof DemoStartRateLimitError) {
      const retryAfterSec = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      res.setHeader('Retry-After', retryAfterSec.toString());
      return res.status(429).json({
        success: false,
        error: 'Слишком много запросов демо-режима. Попробуйте через пару минут.',
        retryAfterMs: err.retryAfterMs,
      });
    }

    if (err instanceof DemoStartQueueOverloadError) {
      return res.status(503).json({
        success: false,
        error: 'Сервер перегружен запросами демо. Попробуйте через несколько секунд.',
      });
    }

    console.error('Demo start error:', err);
    return res.status(500).json({ success: false, error: 'Failed to start demo mode' });
  } finally {
    releaseSlot?.();
  }
});

export default router;
