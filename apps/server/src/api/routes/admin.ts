import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { generateId, getDb } from '../../db';
import { countUserActiveSessionsBulk } from '../../redis';
import { getLiveSessionParticipantCounts, getLiveSessionSnapshots, getLiveSessionVideoSnapshots } from '../../socket';
import { clearServerErrorLogs, getServerErrorLogs, getServerErrorSummary } from '../../monitoring/errors';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_LOGIN || !process.env.ADMIN_PASSWORD)) {
  throw new Error('ADMIN_LOGIN and ADMIN_PASSWORD must be set in production');
}

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  coach_owner_id: string | null;
  subscription_status: string;
  created_at: string;
  max_devices_override: number | null;
  max_sessions_override: number | null;
  max_participants_override: number | null;
};

type DemoMetricsDailyRow = {
  day: string;
  starts: number | string;
  sessions_created: number | string;
  participant_joins: number | string;
};

type DemoSessionRow = {
  id: string;
  name: string;
  owner_id: string;
  owner_email: string | null;
  youtube_url: string;
  youtube_video_id: string;
  max_participants: number | string;
  demo_expires_at: string | null;
  created_at: string;
};

type AdminSessionRow = {
  id: string;
  name: string;
  owner_id: string;
  owner_email: string | null;
  owner_name: string | null;
  youtube_url: string;
  youtube_video_id: string;
  max_participants: number | string;
  is_demo: number | string;
  is_active: number | string;
  demo_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function toUtcDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

// Admin auth middleware
function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.admin_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Нет токена' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded.admin) return res.status(403).json({ success: false, error: 'Нет доступа' });
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Невалидный токен' });
  }
}

function resolveAssistantCoachId(db: any, userId: string, coachOwnerIdRaw: unknown) {
  if (coachOwnerIdRaw === undefined) {
    return undefined;
  }

  if (coachOwnerIdRaw === null || coachOwnerIdRaw === '') {
    return null;
  }

  const coachOwnerId = String(coachOwnerIdRaw).trim();
  if (!coachOwnerId) {
    return null;
  }

  if (coachOwnerId === userId) {
    throw new Error('Нельзя назначить пользователя ассистентом самого себя');
  }

  const coach = db
    .prepare('SELECT id, coach_owner_id FROM users WHERE id = ?')
    .get(coachOwnerId) as { id: string; coach_owner_id: string | null } | undefined;

  if (!coach) {
    throw new Error('Тренер для ассистента не найден');
  }

  if (coach.coach_owner_id) {
    throw new Error('Нельзя назначить ассистента в качестве тренера');
  }

  return coachOwnerId;
}

async function resolvePasswordHashForCreate(
  db: any,
  password: unknown,
  coachOwnerId: string | null,
  copyPasswordFromCoachRaw: unknown
): Promise<string> {
  const copyPasswordFromCoach = Boolean(copyPasswordFromCoachRaw);

  if (copyPasswordFromCoach) {
    if (!coachOwnerId) {
      throw new Error('Для копирования пароля нужно выбрать тренера');
    }

    const coach = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(coachOwnerId) as { password_hash: string | null } | undefined;

    if (!coach?.password_hash) {
      throw new Error('У выбранного тренера нет пароля для копирования');
    }

    return coach.password_hash;
  }

  const passwordValue = typeof password === 'string' ? password : '';
  if (!passwordValue) {
    throw new Error('Пароль обязателен при создании');
  }

  return bcrypt.hash(passwordValue, 12);
}

// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  if (login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
  res.json({ success: true });
});

// GET /api/admin/me
router.get('/me', adminMiddleware, async (_req, res) => {
  res.json({ success: true, data: { authenticated: true } });
});

// POST /api/admin/logout
router.post('/logout', async (_req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

// POST /api/admin/demo/reset - reset demo metrics counters
router.post('/demo/reset', adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const scope = req.body?.scope === 'today' ? 'today' : 'all';

    if (scope === 'today') {
      const todayKey = toUtcDayKey(new Date());
      db.prepare('INSERT OR IGNORE INTO demo_metrics_daily (day) VALUES (?)').run(todayKey);
      db.prepare(
        `UPDATE demo_metrics_daily
         SET starts = 0,
             sessions_created = 0,
             participant_joins = 0
         WHERE day = ?`
      ).run(todayKey);
    } else {
      db.prepare('DELETE FROM demo_metrics_daily').run();
    }

    res.json({ success: true, data: { scope } });
  } catch (error) {
    console.error('Admin demo reset error:', error);
    res.status(500).json({ success: false, error: 'Ошибка сброса demo-счетчиков' });
  }
});
// GET /api/admin/demo/overview - live + historical metrics for demo mode
router.get('/demo/overview', adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayKey = toUtcDayKey(now);
    const requestedLimit = Number(req.query.limit || 200);
    const liveSessionLimit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(20, Math.floor(requestedLimit)))
      : 200;

    const liveParticipantCounts = getLiveSessionParticipantCounts();
    const liveVideoStates = getLiveSessionVideoSnapshots();

    const activeDemoUsersRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE is_demo_user = 1 AND demo_expires_at > ?'
    ).get(nowIso) as { cnt: number | string } | undefined;
    const activeDemoSessionsCountRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM sessions WHERE is_demo = 1 AND is_active = 1 AND demo_expires_at > ?'
    ).get(nowIso) as { cnt: number | string } | undefined;

    const activeDemoSessions = db.prepare(
      `SELECT s.id, s.name, s.owner_id, s.youtube_url, s.youtube_video_id, s.max_participants, s.demo_expires_at, s.created_at,
              u.email as owner_email
       FROM sessions s
       LEFT JOIN users u ON u.id = s.owner_id
       WHERE s.is_demo = 1
         AND s.is_active = 1
         AND s.demo_expires_at > ?
       ORDER BY s.created_at DESC
       LIMIT ?`
    ).all(nowIso, liveSessionLimit) as DemoSessionRow[];

    const liveSessions = activeDemoSessions.map((session) => {
      const onlineParticipants = Number(liveParticipantCounts[session.id] || 0);
      const maxParticipants = Number(session.max_participants || 0);
      const expiresAt = session.demo_expires_at;
      const secondsLeft = expiresAt
        ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000))
        : 0;
      const video = liveVideoStates[session.id];

      return {
        id: session.id,
        name: session.name,
        ownerId: session.owner_id,
        ownerEmail: session.owner_email,
        youtubeUrl: session.youtube_url,
        youtubeVideoId: session.youtube_video_id,
        maxParticipants,
        onlineParticipants,
        demoExpiresAt: expiresAt,
        secondsLeft,
        createdAt: session.created_at,
        currentVideoTime: video ? Number(video.currentTime || 0) : null,
        isPlaying: video ? Boolean(video.isPlaying) : false,
      };
    });

    const aggregate = db.prepare(
      `SELECT
         COALESCE(SUM(starts), 0) as starts,
         COALESCE(SUM(sessions_created), 0) as sessions_created,
         COALESCE(SUM(participant_joins), 0) as participant_joins
       FROM demo_metrics_daily`
    ).get() as { starts: number | string; sessions_created: number | string; participant_joins: number | string } | undefined;

    const today = db.prepare(
      `SELECT day, starts, sessions_created, participant_joins
       FROM demo_metrics_daily
       WHERE day = ?`
    ).get(todayKey) as DemoMetricsDailyRow | undefined;

    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
    const weekStartKey = toUtcDayKey(weekStart);
    const weekRows = db.prepare(
      `SELECT day, starts, sessions_created, participant_joins
       FROM demo_metrics_daily
       WHERE day >= ?
       ORDER BY day ASC`
    ).all(weekStartKey) as DemoMetricsDailyRow[];
    const weekMap = new Map(weekRows.map((row) => [row.day, row]));

    const last7Days = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - index)));
      const key = toUtcDayKey(date);
      const row = weekMap.get(key);

      return {
        day: key,
        starts: Number(row?.starts || 0),
        sessionsCreated: Number(row?.sessions_created || 0),
        participantJoins: Number(row?.participant_joins || 0),
      };
    });

    const activeDemoParticipants = liveSessions.reduce((sum, session) => sum + session.onlineParticipants, 0);

    res.json({
      success: true,
      data: {
        generatedAt: nowIso,
        live: {
          activeDemoUsers: Number(activeDemoUsersRow?.cnt || 0),
          activeDemoSessions: Number(activeDemoSessionsCountRow?.cnt || 0),
          listedDemoSessions: liveSessions.length,
          liveSessionLimit,
          activeDemoParticipants,
          sessions: liveSessions,
        },
        totals: {
          starts: Number(aggregate?.starts || 0),
          sessionsCreated: Number(aggregate?.sessions_created || 0),
          participantJoins: Number(aggregate?.participant_joins || 0),
        },
        today: {
          day: todayKey,
          starts: Number(today?.starts || 0),
          sessionsCreated: Number(today?.sessions_created || 0),
          participantJoins: Number(today?.participant_joins || 0),
        },
        last7Days,
      },
    });
  } catch (error) {
    console.error('Admin demo overview error:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения demo-статистики' });
  }
});

// GET /api/admin/sessions/overview - live sessions grouped by owner
router.get('/sessions/overview', adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const requestedLimit = Number(req.query.limit || 300);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(50, Math.floor(requestedLimit)))
      : 300;

    const totalActiveRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM sessions WHERE is_active = 1'
    ).get() as { cnt: number | string } | undefined;

    const sessions = db.prepare(
      `SELECT s.id, s.name, s.owner_id, s.youtube_url, s.youtube_video_id,
              s.max_participants, s.is_demo, s.is_active, s.demo_expires_at, s.created_at, s.updated_at,
              u.email as owner_email, u.name as owner_name
       FROM sessions s
       LEFT JOIN users u ON u.id = s.owner_id
       WHERE s.is_active = 1
       ORDER BY s.updated_at DESC
       LIMIT ?`
    ).all(limit) as AdminSessionRow[];

    const liveSnapshots = getLiveSessionSnapshots();
    const ownerIds = [...new Set(sessions.map((session) => session.owner_id).filter(Boolean))];
    const ownerActiveDevices = await countUserActiveSessionsBulk(ownerIds);

    const sessionRows = sessions.map((session) => {
      const live = liveSnapshots[session.id];
      const maxParticipants = Number(session.max_participants || 0);
      const participantsTotal = Number(live?.participantCount || 0);
      const participantsGuests = Number(live?.guestCount || 0);
      const participantsAuthenticated = Number(live?.authenticatedCount || 0);
      const expiresAt = session.demo_expires_at;
      const secondsLeft = expiresAt
        ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000))
        : null;

      return {
        id: session.id,
        name: session.name,
        ownerId: session.owner_id,
        ownerEmail: session.owner_email,
        ownerName: session.owner_name,
        ownerActiveDevices: Number(ownerActiveDevices[session.owner_id] || 0),
        youtubeUrl: session.youtube_url,
        youtubeVideoId: session.youtube_video_id,
        maxParticipants,
        isDemo: Number(session.is_demo || 0) === 1,
        isActive: Number(session.is_active || 0) === 1,
        demoExpiresAt: expiresAt,
        secondsLeft,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        boardOpen: Boolean(live?.boardOpen),
        currentVideoTime: live ? Number(live.videoState.currentTime || 0) : null,
        isPlaying: live ? Boolean(live.videoState.isPlaying) : false,
        participants: {
          total: participantsTotal,
          authenticated: participantsAuthenticated,
          guests: participantsGuests,
          users: live?.participants || [],
        },
      };
    });

    const ownerMap = new Map<string, {
      ownerId: string;
      ownerEmail: string | null;
      ownerName: string | null;
      ownerActiveDevices: number;
      sessionsTotal: number;
      sessionsLive: number;
      participantsTotal: number;
      participantsGuests: number;
      participantsAuthenticated: number;
    }>();

    for (const session of sessionRows) {
      const ownerId = session.ownerId || 'unknown-owner';
      const current = ownerMap.get(ownerId) || {
        ownerId,
        ownerEmail: session.ownerEmail || null,
        ownerName: session.ownerName || null,
        ownerActiveDevices: session.ownerActiveDevices,
        sessionsTotal: 0,
        sessionsLive: 0,
        participantsTotal: 0,
        participantsGuests: 0,
        participantsAuthenticated: 0,
      };

      current.sessionsTotal += 1;
      if (session.participants.total > 0) {
        current.sessionsLive += 1;
      }
      current.participantsTotal += session.participants.total;
      current.participantsGuests += session.participants.guests;
      current.participantsAuthenticated += session.participants.authenticated;
      current.ownerActiveDevices = Math.max(current.ownerActiveDevices, session.ownerActiveDevices);
      ownerMap.set(ownerId, current);
    }

    const owners = [...ownerMap.values()].sort((a, b) => b.participantsTotal - a.participantsTotal);
    const participantsOnline = sessionRows.reduce((sum, row) => sum + row.participants.total, 0);
    const guestParticipantsOnline = sessionRows.reduce((sum, row) => sum + row.participants.guests, 0);
    const authenticatedParticipantsOnline = sessionRows.reduce((sum, row) => sum + row.participants.authenticated, 0);
    const sessionsWithParticipants = sessionRows.filter((row) => row.participants.total > 0).length;

    const uniqueOwnerIds = [...new Set(sessionRows.map((row) => row.ownerId).filter(Boolean))];
    const activeOwnerDevices = uniqueOwnerIds.reduce(
      (sum, ownerId) => sum + Number(ownerActiveDevices[ownerId] || 0),
      0
    );

    const totalActiveSessions = Number(totalActiveRow?.cnt || 0);
    res.json({
      success: true,
      data: {
        generatedAt: nowIso,
        summary: {
          totalActiveSessions,
          listedSessions: sessionRows.length,
          sessionsWithParticipants,
          participantsOnline,
          guestParticipantsOnline,
          authenticatedParticipantsOnline,
          activeOwnerDevices,
        },
        owners,
        sessions: sessionRows,
        meta: {
          limit,
          total: totalActiveSessions,
          truncated: totalActiveSessions > sessionRows.length,
        },
      },
    });
  } catch (error) {
    console.error('Admin sessions overview error:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения статистики сессий' });
  }
});

// GET /api/admin/users/:id/sessions/stats - per-profile session stats
router.get('/users/:id/sessions/stats', adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.params.id;
    const requestedLimit = Number(req.query.limit || 120);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(500, Math.max(20, Math.floor(requestedLimit)))
      : 120;

    const user = db.prepare(
      `SELECT id, email, name, plan, created_at
       FROM users
       WHERE id = ?`
    ).get(userId) as { id: string; email: string; name: string | null; plan: string; created_at: string } | undefined;

    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const totalSessionsRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM sessions WHERE owner_id = ?'
    ).get(userId) as { cnt: number | string } | undefined;
    const activeSessionsRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM sessions WHERE owner_id = ? AND is_active = 1'
    ).get(userId) as { cnt: number | string } | undefined;
    const demoSessionsRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM sessions WHERE owner_id = ? AND is_demo = 1'
    ).get(userId) as { cnt: number | string } | undefined;
    const storedDrawingsRow = db.prepare(
      `SELECT COUNT(*) as cnt
       FROM drawings d
       INNER JOIN sessions s ON s.id = d.session_id
       WHERE s.owner_id = ?`
    ).get(userId) as { cnt: number | string } | undefined;

    const recentSessions = db.prepare(
      `SELECT id, name, youtube_url, youtube_video_id, max_participants, is_demo, is_active, demo_expires_at, created_at, updated_at
       FROM sessions
       WHERE owner_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(userId, limit) as Array<{
      id: string;
      name: string;
      youtube_url: string;
      youtube_video_id: string;
      max_participants: number | string;
      is_demo: number | string;
      is_active: number | string;
      demo_expires_at: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const sessionIds = recentSessions.map((session) => session.id);
    const drawingsBySessionId = new Map<string, number>();

    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map(() => '?').join(', ');
      const drawingRows = db.prepare(
        `SELECT session_id, COUNT(*) as cnt
         FROM drawings
         WHERE session_id IN (${placeholders})
         GROUP BY session_id`
      ).all(...sessionIds) as Array<{ session_id: string; cnt: number | string }>;

      for (const row of drawingRows) {
        drawingsBySessionId.set(row.session_id, Number(row.cnt || 0));
      }
    }

    const liveSnapshots = getLiveSessionSnapshots();
    const ownerLiveSnapshots = Object.values(liveSnapshots).filter((snapshot) => snapshot.ownerId === userId);
    const devicesByUserId = await countUserActiveSessionsBulk([userId]);
    const ownerActiveDevices = Number(devicesByUserId[userId] || 0);
    const now = new Date();

    const recentSessionRows = recentSessions.map((session) => {
      const live = liveSnapshots[session.id];
      const expiresAt = session.demo_expires_at;
      const secondsLeft = expiresAt
        ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000))
        : null;

      return {
        id: session.id,
        name: session.name,
        youtubeUrl: session.youtube_url,
        youtubeVideoId: session.youtube_video_id,
        maxParticipants: Number(session.max_participants || 0),
        isDemo: Number(session.is_demo || 0) === 1,
        isActive: Number(session.is_active || 0) === 1,
        demoExpiresAt: expiresAt,
        secondsLeft,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        storedDrawings: Number(drawingsBySessionId.get(session.id) || 0),
        live: {
          participantsTotal: Number(live?.participantCount || 0),
          participantsAuthenticated: Number(live?.authenticatedCount || 0),
          participantsGuests: Number(live?.guestCount || 0),
          boardOpen: Boolean(live?.boardOpen),
          currentVideoTime: live ? Number(live.videoState.currentTime || 0) : null,
          isPlaying: live ? Boolean(live.videoState.isPlaying) : false,
        },
      };
    });

    const nowUtc = new Date();
    const weekStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 6));
    const weekStartIso = weekStart.toISOString();
    const weekRows = db.prepare(
      `SELECT SUBSTR(created_at, 1, 10) as day, COUNT(*) as cnt
       FROM sessions
       WHERE owner_id = ? AND created_at >= ?
       GROUP BY SUBSTR(created_at, 1, 10)
       ORDER BY day ASC`
    ).all(userId, weekStartIso) as Array<{ day: string; cnt: number | string }>;
    const weekMap = new Map(weekRows.map((row) => [row.day, Number(row.cnt || 0)]));

    const last7Days = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - (6 - index)));
      const day = date.toISOString().slice(0, 10);
      return {
        day,
        sessionsCreated: Number(weekMap.get(day) || 0),
      };
    });

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          createdAt: user.created_at,
        },
        summary: {
          ownerActiveDevices,
          totalSessions: Number(totalSessionsRow?.cnt || 0),
          activeSessions: Number(activeSessionsRow?.cnt || 0),
          demoSessions: Number(demoSessionsRow?.cnt || 0),
          storedDrawings: Number(storedDrawingsRow?.cnt || 0),
          liveSessions: ownerLiveSnapshots.length,
          liveParticipantsTotal: ownerLiveSnapshots.reduce((sum, item) => sum + Number(item.participantCount || 0), 0),
          liveParticipantsAuthenticated: ownerLiveSnapshots.reduce((sum, item) => sum + Number(item.authenticatedCount || 0), 0),
          liveParticipantsGuests: ownerLiveSnapshots.reduce((sum, item) => sum + Number(item.guestCount || 0), 0),
        },
        recentSessions: recentSessionRows,
        last7Days,
      },
    });
  } catch (error) {
    console.error('Admin user sessions stats error:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения статистики профиля' });
  }
});

// GET /api/admin/errors - recent server-side error logs
router.get('/errors', adminMiddleware, async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit || 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(20, Math.floor(requestedLimit)))
      : 200;
    const requestedWindowMinutes = Number(req.query.windowMinutes || 60);
    const summary = getServerErrorSummary(requestedWindowMinutes);
    const entries = getServerErrorLogs(limit);

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        summary,
        entries,
      },
    });
  } catch (error) {
    console.error('Admin errors logs fetch error:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения логов ошибок' });
  }
});

// POST /api/admin/errors/clear - clear server-side error log buffer
router.post('/errors/clear', adminMiddleware, async (_req, res) => {
  try {
    clearServerErrorLogs();
    res.json({ success: true });
  } catch (error) {
    console.error('Admin errors clear error:', error);
    res.status(500).json({ success: false, error: 'Ошибка очистки логов' });
  }
});

// GET /api/admin/users — enriched with live stats
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const requestedLimit = Number(req.query.limit || 1000);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(5000, Math.max(100, Math.floor(requestedLimit)))
      : 1000;

    const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number | string } | undefined;
    const users = db.prepare(
      `SELECT u.id, u.email, u.name, u.plan, u.coach_owner_id, u.subscription_status, u.created_at,
              u.max_devices_override, u.max_sessions_override, u.max_participants_override,
              c.email AS coach_login
       FROM users u
       LEFT JOIN users c ON c.id = u.coach_owner_id
       ORDER BY u.created_at DESC
       LIMIT ?`
    ).all(limit) as Array<UserRow & { coach_login: string | null }>;

    const activeDeviceByUserId = await countUserActiveSessionsBulk(users.map((user) => user.id));
    const activeSessionRows = db.prepare(
      `SELECT owner_id, COUNT(*) as cnt
       FROM sessions
       WHERE is_active = 1
       GROUP BY owner_id`
    ).all() as Array<{ owner_id: string; cnt: number | string }>;
    const activeSessionByOwnerId = new Map(activeSessionRows.map((row) => [row.owner_id, Number(row.cnt || 0)]));
    const liveSnapshots = getLiveSessionSnapshots();
    const liveByOwnerId = new Map<string, {
      live_sessions: number;
      live_participants_total: number;
      live_participants_guests: number;
      live_participants_authenticated: number;
    }>();

    for (const snapshot of Object.values(liveSnapshots)) {
      const ownerId = snapshot.ownerId;
      if (!ownerId) continue;

      const current = liveByOwnerId.get(ownerId) || {
        live_sessions: 0,
        live_participants_total: 0,
        live_participants_guests: 0,
        live_participants_authenticated: 0,
      };

      if (snapshot.participantCount > 0) {
        current.live_sessions += 1;
      }
      current.live_participants_total += Number(snapshot.participantCount || 0);
      current.live_participants_guests += Number(snapshot.guestCount || 0);
      current.live_participants_authenticated += Number(snapshot.authenticatedCount || 0);
      liveByOwnerId.set(ownerId, current);
    }

    const enriched = users.map((u) => {
      const activeDevices = Number(activeDeviceByUserId[u.id] || 0);
      const activeSessions = Number(activeSessionByOwnerId.get(u.id) || 0);
      const liveStats = liveByOwnerId.get(u.id);
      return {
        ...u,
        active_devices: activeDevices,
        active_sessions: activeSessions,
        live_sessions: Number(liveStats?.live_sessions || 0),
        live_participants_total: Number(liveStats?.live_participants_total || 0),
        live_participants_guests: Number(liveStats?.live_participants_guests || 0),
        live_participants_authenticated: Number(liveStats?.live_participants_authenticated || 0),
        is_online: activeDevices > 0,
      };
    });

    const total = Number(totalRow?.cnt || 0);
    res.json({
      success: true,
      data: enriched,
      meta: {
        total,
        limit,
        truncated: total > enriched.length,
      },
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения пользователей' });
  }
});
// POST /api/admin/users
router.post('/users', adminMiddleware, async (req, res) => {
  try {
    const {
      login,
      password,
      name,
      plan,
      coach_owner_id,
      copy_password_from_coach,
      max_devices_override,
      max_sessions_override,
      max_participants_override,
    } = req.body;

    if (!login) {
      return res.status(400).json({ success: false, error: 'Логин обязателен' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(login);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Пользователь с таким логином уже существует' });
    }

    const id = generateId();
    const resolvedCoachOwnerId = resolveAssistantCoachId(db, id, coach_owner_id);
    const passwordHash = await resolvePasswordHashForCreate(db, password, resolvedCoachOwnerId ?? null, copy_password_from_coach);
    const userPlan = plan || 'free';
    const safeMaxSessionsOverride = resolvedCoachOwnerId ? null : (max_sessions_override ?? null);
    const safeMaxParticipantsOverride = resolvedCoachOwnerId ? null : (max_participants_override ?? null);

    db.prepare(
      `INSERT INTO users (
         id, email, password_hash, name, plan, coach_owner_id,
         max_devices_override, max_sessions_override, max_participants_override
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      login,
      passwordHash,
      name || null,
      userPlan,
      resolvedCoachOwnerId ?? null,
      max_devices_override ?? null,
      safeMaxSessionsOverride,
      safeMaxParticipantsOverride,
    );

    const user = db.prepare(
      `SELECT u.id, u.email, u.name, u.plan, u.coach_owner_id, u.subscription_status, u.created_at,
              u.max_devices_override, u.max_sessions_override, u.max_participants_override,
              c.email AS coach_login
       FROM users u
       LEFT JOIN users c ON c.id = u.coach_owner_id
       WHERE u.id = ?`
    ).get(id);
    res.json({ success: true, data: user });
  } catch (error: any) {
    console.error('Admin create user error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка создания пользователя' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      login,
      name,
      plan,
      password,
      coach_owner_id,
      copy_password_from_coach,
      max_devices_override,
      max_sessions_override,
      max_participants_override,
    } = req.body;

    const db = getDb();
    const user = db.prepare('SELECT id, coach_owner_id FROM users WHERE id = ?').get(id) as { id: string; coach_owner_id: string | null } | undefined;
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    if (login !== undefined) {
      const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(login, id);
      if (conflict) return res.status(400).json({ success: false, error: 'Этот логин уже занят' });
      db.prepare('UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(login, id);
    }
    if (name !== undefined) {
      db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name || null, id);
    }
    if (plan !== undefined) {
      db.prepare('UPDATE users SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(plan, id);
    }

    let resolvedCoachOwnerId = user.coach_owner_id;
    if (coach_owner_id !== undefined) {
      resolvedCoachOwnerId = resolveAssistantCoachId(db, id, coach_owner_id) ?? null;
      db.prepare('UPDATE users SET coach_owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(resolvedCoachOwnerId, id);
    }
    const isAssistant = Boolean(resolvedCoachOwnerId);

    if (copy_password_from_coach) {
      if (!resolvedCoachOwnerId) {
        return res.status(400).json({ success: false, error: 'Для копирования пароля нужно выбрать тренера' });
      }
      const coach = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(resolvedCoachOwnerId) as { password_hash: string | null } | undefined;
      if (!coach?.password_hash) {
        return res.status(400).json({ success: false, error: 'У выбранного тренера нет пароля для копирования' });
      }
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(coach.password_hash, id);
    } else if (password) {
      const hash = await bcrypt.hash(password, 12);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, id);
    }

    if (max_devices_override !== undefined) {
      db.prepare('UPDATE users SET max_devices_override = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(max_devices_override === '' ? null : max_devices_override, id);
    }
    if (isAssistant) {
      db.prepare(
        'UPDATE users SET max_sessions_override = NULL, max_participants_override = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(id);
    } else {
      if (max_sessions_override !== undefined) {
        db.prepare('UPDATE users SET max_sessions_override = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(max_sessions_override === '' ? null : max_sessions_override, id);
      }
      if (max_participants_override !== undefined) {
        db.prepare('UPDATE users SET max_participants_override = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(max_participants_override === '' ? null : max_participants_override, id);
      }
    }

    const updated = db.prepare(
      `SELECT u.id, u.email, u.name, u.plan, u.coach_owner_id, u.subscription_status, u.created_at,
              u.max_devices_override, u.max_sessions_override, u.max_participants_override,
              c.email AS coach_login
       FROM users u
       LEFT JOIN users c ON c.id = u.coach_owner_id
       WHERE u.id = ?`
    ).get(id);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Admin update user error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Ошибка обновления пользователя' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    // Unlink assistants if coach account is deleted.
    db.prepare('UPDATE users SET coach_owner_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE coach_owner_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ success: false, error: 'Ошибка удаления пользователя' });
  }
});

export default router;

