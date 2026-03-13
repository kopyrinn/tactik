import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { query, queryOne } from '../../db';
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

    const user = await queryOne<any>(
      `UPDATE users 
       SET name = COALESCE($2, name), 
           avatar_url = COALESCE($3, avatar_url),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, name, avatar_url, plan, coach_owner_id, subscription_status, 
                 subscription_end_date, created_at, updated_at`,
      [userId, name, avatarUrl]
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

    const stats = await queryOne<any>(
      `SELECT 
         COUNT(DISTINCT s.id) as sessions_created,
         COUNT(DISTINCT d.id) as drawings_created,
         MAX(ul.created_at) as last_activity
       FROM users u
       LEFT JOIN sessions s ON s.owner_id = u.id
       LEFT JOIN drawings d ON d.user_id = u.id
       LEFT JOIN usage_logs ul ON ul.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    const usageStats: UsageStats = {
      sessionsCreated: parseInt(stats?.sessions_created || '0'),
      drawingsCreated: parseInt(stats?.drawings_created || '0'),
      totalDuration: 0, // TODO: Calculate from usage logs
      lastActivity: stats?.last_activity || null,
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
