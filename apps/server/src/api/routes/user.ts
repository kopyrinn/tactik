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
    const usageTotalsRow = await queryOne<{
      sessions_created: number | string;
      drawings_created: number | string;
      board_drawings_created: number | string;
      last_activity_at: string | null;
    }>(
      `SELECT
         COALESCE(SUM(sessions_created), 0) AS sessions_created,
         COALESCE(SUM(drawings_created), 0) AS drawings_created,
         COALESCE(SUM(board_drawings_created), 0) AS board_drawings_created,
         MAX(last_activity_at) AS last_activity_at
       FROM user_usage_metrics_daily
       WHERE user_id = $1`,
      [userId]
    );

    const usageStats: UsageStats = {
      sessionsCreated: Math.max(parseInt(sessionsRow?.cnt || '0'), Number(usageTotalsRow?.sessions_created || 0)),
      drawingsCreated: Math.max(
        parseInt(drawingsRow?.cnt || '0'),
        Number(usageTotalsRow?.drawings_created || 0) + Number(usageTotalsRow?.board_drawings_created || 0)
      ),
      totalDuration: 0,
      lastActivity: usageTotalsRow?.last_activity_at ? new Date(usageTotalsRow.last_activity_at) : null,
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
