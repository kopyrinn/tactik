import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getDb, query, queryOne } from '../../db';
import type { User, ApiResponse, UsageStats } from '../../types';

const router = Router();

// Get user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId!;

    const user = await queryOne<any>(
      `SELECT id, email, name, avatar_url, plan, coach_owner_id, subscription_status,
              subscription_end_date, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return res.status(404).json({
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
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get profile',
    } as ApiResponse);
  }
});

// Update user profile
router.patch('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId!;
    const { name, avatarUrl } = req.body;

    const db = getDb();
    db.prepare(
      `UPDATE users
       SET name = COALESCE(?, name),
           avatar_url = COALESCE(?, avatar_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(name ?? null, avatarUrl ?? null, userId);

    const user = db.prepare(
      `SELECT id, email, name, avatar_url, plan, coach_owner_id, subscription_status,
              subscription_end_date, created_at, updated_at
       FROM users WHERE id = ?`
    ).get(userId) as any;

    if (!user) {
      return res.status(404).json({
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
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
    } as ApiResponse);
  }
});

// Get usage stats
router.get('/usage', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId!;

    const sessionsRow = await queryOne<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM sessions WHERE owner_id = $1',
      [userId]
    );
    const drawingsRow = await queryOne<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM drawings WHERE user_id = $1',
      [userId]
    );

    const usageStats: UsageStats = {
      sessionsCreated: parseInt(sessionsRow?.cnt || '0'),
      drawingsCreated: parseInt(drawingsRow?.cnt || '0'),
      totalDuration: 0,
      lastActivity: null,
    };

    res.json({
      success: true,
      data: usageStats,
    } as ApiResponse<UsageStats>);
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage stats',
    } as ApiResponse);
  }
});

export default router;
