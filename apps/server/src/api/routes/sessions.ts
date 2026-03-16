import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { generateId, getDb, incrementDemoMetric, query, queryOne } from '../../db';
import { authMiddleware } from '../middleware/auth';
import type { Session, ApiResponse } from '../../types';

const router = Router();

// Validation
const createSessionSchema = z.object({
  name: z.string().min(1).max(255),
  youtubeUrl: z.string().url(),
});

const boardPieceLabelItemSchema = z.object({
  id: z.string().regex(/^[ry]-\d+$/),
  label: z.string().trim().max(3),
});

const boardPieceLabelsSchema = z.object({
  red: z.array(boardPieceLabelItemSchema).length(11),
  yellow: z.array(boardPieceLabelItemSchema).length(11),
});

const boardStatePieceSchema = z.object({
  id: z.string().regex(/^(?:[ry]-\d+|ball)$/),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const boardStateSchema = z.object({
  pieces: z.array(boardStatePieceSchema).min(1).max(30),
  drawings: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(2000)).max(500),
});

// Extract YouTube video ID from URL
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function normalizeYoutubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return YOUTUBE_ID_PATTERN.test(normalized) ? normalized : null;
}

function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com') ||
    host === 'youtu.be'
  );
}

function extractYoutubeIdFromParsedUrl(parsedUrl: URL): string | null {
  if (!isYoutubeHost(parsedUrl.hostname)) return null;

  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    return normalizeYoutubeVideoId(pathParts[0]);
  }

  const queryVideoId =
    normalizeYoutubeVideoId(parsedUrl.searchParams.get('v')) ||
    normalizeYoutubeVideoId(parsedUrl.searchParams.get('vi'));
  if (queryVideoId) return queryVideoId;

  const [prefix, possibleId] = pathParts;
  if (prefix === 'attribution_link') {
    const nestedUrl = parsedUrl.searchParams.get('u');
    if (!nestedUrl) return null;

    try {
      const parsedNestedUrl = new URL(nestedUrl, 'https://www.youtube.com');
      return extractYoutubeIdFromParsedUrl(parsedNestedUrl);
    } catch {
      return null;
    }
  }

  if (prefix && ['embed', 'live', 'shorts', 'v'].includes(prefix)) {
    return normalizeYoutubeVideoId(possibleId);
  }

  return null;
}

function extractYoutubeId(url: string): string | null {
  const trimmed = url.trim();
  const directId = normalizeYoutubeVideoId(trimmed);
  if (directId) return directId;

  const urlCandidates = [trimmed];
  if (!/^https?:\/\//i.test(trimmed)) {
    urlCandidates.push(`https://${trimmed}`);
  }

  for (const candidate of urlCandidates) {
    try {
      const parsed = new URL(candidate);
      const extractedId = extractYoutubeIdFromParsedUrl(parsed);
      if (extractedId) return extractedId;
    } catch {
      continue;
    }
  }

  const fallbackPatterns = [
    /(?:youtube\.com\/(?:watch\?.*?[?&]v=|embed\/|live\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
  ];

  for (const pattern of fallbackPatterns) {
    const match = trimmed.match(pattern);
    const extractedId = normalizeYoutubeVideoId(match?.[1]);
    if (extractedId) {
      return extractedId;
    }
  }

  return null;
}

function parseBoardPieceLabels(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  try {
    return boardPieceLabelsSchema.parse(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

function parseBoardState(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  try {
    return boardStateSchema.parse(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

function toSessionData(session: any): Session {
  const storedVideoId = normalizeYoutubeVideoId(session.youtube_video_id);
  const derivedVideoId = extractYoutubeId(session.youtube_url);

  return {
    id: session.id,
    ownerId: session.owner_id,
    name: session.name,
    youtubeUrl: session.youtube_url,
    youtubeVideoId: storedVideoId || derivedVideoId || session.youtube_video_id,
    qrCode: session.qr_code,
    joinCode: session.join_code ?? null,
    boardPieceLabels: parseBoardPieceLabels(session.board_piece_labels),
    boardState: parseBoardState(session.board_state),
    maxParticipants: session.max_participants,
    isActive: Boolean(session.is_active),
    isDemo: Boolean(session.is_demo),
    demoExpiresAt: session.demo_expires_at ?? null,
    demoRoomCode: session.demo_room_code ?? null,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

function toPublicSessionData(session: any): Session {
  const data = toSessionData(session);
  return {
    ...data,
    qrCode: null,
    joinCode: null,
    boardPieceLabels: null,
    boardState: null,
  };
}

const LOCAL_QR_FRONTEND_FALLBACK = 'http://localhost:3000';

function getFrontendBaseUrlForQr() {
  const explicitQrUrl = (process.env.FRONTEND_QR_URL || '').trim();
  if (explicitQrUrl) return explicitQrUrl;

  const firstFrontendUrl = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);

  const isDevelopment = process.env.NODE_ENV !== 'production';
  const isLocalhostFrontend = !!firstFrontendUrl
    && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(firstFrontendUrl);

  if (isDevelopment && (!firstFrontendUrl || isLocalhostFrontend)) {
    return LOCAL_QR_FRONTEND_FALLBACK;
  }

  return firstFrontendUrl || 'http://localhost:3000';
}

async function canManageSessionBoard(ownerId: string, userId: string) {
  if (ownerId === userId) return true;

  const user = await queryOne<{ coach_owner_id: string | null }>(
    'SELECT coach_owner_id FROM users WHERE id = $1',
    [userId]
  );
  return user?.coach_owner_id === ownerId;
}

// Create session
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, youtubeUrl } = createSessionSchema.parse(req.body);
    const userId = req.userId!;

    // Extract video ID
    const videoId = extractYoutubeId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL',
      } as ApiResponse);
    }

    // Check user's plan limits
    const user = await queryOne<any>(
      `SELECT plan, coach_owner_id, max_sessions_override, max_participants_override,
              is_demo_user, demo_expires_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const isDemoUser = user?.is_demo_user === 1;
    const demoExpired = isDemoUser
      && user?.demo_expires_at
      && new Date(user.demo_expires_at).getTime() <= Date.now();

    if (demoExpired) {
      return res.status(403).json({
        success: false,
        error: 'Демо-режим истёк. Запустите новый тест.',
      } as ApiResponse);
    }

    if (user?.coach_owner_id) {
      return res.status(403).json({
        success: false,
        error: 'Ассистент не может создавать сессии. Сессии создаёт тренер.',
      } as ApiResponse);
    }

    // Determine session limit (override takes priority over plan default).
    // Free/assistant accounts cannot create sessions by default.
    const planSessionLimits: Record<string, number> = { free: 0, coach: 10, pro: 20 };
    const sessionLimit = user?.max_sessions_override != null
      ? user.max_sessions_override
      : (planSessionLimits[user?.plan || 'free'] ?? 0);

    if (sessionLimit <= 0) {
      return res.status(403).json({
        success: false,
        error: 'У этого аккаунта нет прав на создание сессий. Используйте профиль мастера.',
      } as ApiResponse);
    }

    // Count active sessions
    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM sessions WHERE owner_id = $1 AND is_active = 1',
      [userId]
    );
    const count = parseInt(countResult?.count || '0');

    if (count >= sessionLimit) {
      return res.status(403).json({
        success: false,
        error: `Достигнут лимит активных сессий (${sessionLimit}). Закройте неиспользуемые сессии.`,
      } as ApiResponse);
    }

    const latestBoardConfig = await queryOne<{ board_piece_labels: string | null }>(
      `SELECT board_piece_labels
       FROM sessions
       WHERE owner_id = $1 AND board_piece_labels IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );

    // Create session
    const sessionId = generateId();
    const db = getDb();
    db.prepare(`
      INSERT INTO sessions (
        id, owner_id, name, youtube_url, youtube_video_id,
        board_piece_labels, board_state, max_participants, join_code,
        is_demo, demo_expires_at, demo_room_code
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
    `).run(
      sessionId,
      userId,
      name,
      youtubeUrl,
      videoId,
      latestBoardConfig?.board_piece_labels || null,
      null,
      user?.max_participants_override != null
        ? user.max_participants_override
        : (user?.plan === 'pro' ? 6 : user?.plan === 'coach' ? 4 : 2),
      isDemoUser ? 1 : 0,
      isDemoUser ? (user?.demo_expires_at || null) : null
    );
    
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as any;

    if (!session) {
      throw new Error('Failed to create session');
    }

    let qrCode: string | null = null;
    if (!isDemoUser) {
      // Demo load tests create many sessions quickly; defer QR generation for demo.
      const joinUrl = `${getFrontendBaseUrlForQr()}/session/${session.id}/join`;
      qrCode = await QRCode.toDataURL(joinUrl);
      await query('UPDATE sessions SET qr_code = $1 WHERE id = $2', [qrCode, session.id]);
    }

    const sessionData: Session = {
      ...toSessionData(session),
      qrCode,
    };

    if (isDemoUser) {
      incrementDemoMetric('sessionsCreated');
    }

    res.json({
      success: true,
      data: sessionData,
    } as ApiResponse<Session>);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      } as ApiResponse);
    }
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create session',
    } as ApiResponse);
  }
});

// Get user's sessions
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId!;
    const user = await queryOne<{ coach_owner_id: string | null }>(
      'SELECT coach_owner_id FROM users WHERE id = $1',
      [userId]
    );
    const ownerId = user?.coach_owner_id || userId;

    const sessions = await query<any>(
      `SELECT * FROM sessions 
       WHERE owner_id = $1 
       ORDER BY created_at DESC`,
      [ownerId]
    );

    const sessionData: Session[] = sessions.map((s) => toSessionData(s));

    res.json({
      success: true,
      data: sessionData,
    } as ApiResponse<Session[]>);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions',
    } as ApiResponse);
  }
});

// Get public session data by ID (display mode)
router.get('/public/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const session = await queryOne<any>(
      'SELECT * FROM sessions WHERE id = $1 AND is_active = 1',
      [id]
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      } as ApiResponse);
    }

    const sessionData: Session = toPublicSessionData(session);

    res.json({
      success: true,
      data: sessionData,
    } as ApiResponse<Session>);
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session',
    } as ApiResponse);
  }
});

// Get session by ID (authenticated)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.userId!;

    const session = await queryOne<any>(
      'SELECT * FROM sessions WHERE id = $1',
      [id]
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      } as ApiResponse);
    }

    const requester = await queryOne<{ coach_owner_id: string | null }>(
      'SELECT coach_owner_id FROM users WHERE id = $1',
      [requesterId]
    );

    const isOwner = session.owner_id === requesterId;
    const isOwnerAssistant = requester?.coach_owner_id === session.owner_id;
    const sessionData: Session = toSessionData(session);

    if (isOwner) {
      const joinUrl = `${getFrontendBaseUrlForQr()}/session/${session.id}/join`;
      const qrCode = await QRCode.toDataURL(joinUrl);
      sessionData.qrCode = qrCode;
      await query('UPDATE sessions SET qr_code = $1 WHERE id = $2', [qrCode, session.id]);
    }

    if (!isOwner && !isOwnerAssistant) {
      sessionData.joinCode = null;
      sessionData.qrCode = null;
      sessionData.boardPieceLabels = null;
      sessionData.boardState = null;
    } else if (!isOwner) {
      // Assistant may work in session, but invite artifacts are owner-only.
      sessionData.joinCode = null;
      sessionData.qrCode = null;
    }

    res.json({
      success: true,
      data: sessionData,
    } as ApiResponse<Session>);
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session',
    } as ApiResponse);
  }
});

// Save board piece labels
router.patch('/:id/board-labels', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const boardPieceLabels = boardPieceLabelsSchema.parse(req.body);

    const session = await queryOne<{ owner_id: string }>(
      'SELECT owner_id FROM sessions WHERE id = $1',
      [id]
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      } as ApiResponse);
    }

    const canManageBoard = await canManageSessionBoard(session.owner_id, userId);
    if (!canManageBoard) {
      return res.status(403).json({
        success: false,
        error: 'Only session owner or assistant can change board labels',
      } as ApiResponse);
    }

    await query(
      'UPDATE sessions SET board_piece_labels = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(boardPieceLabels), id]
    );

    const updated = await queryOne<any>('SELECT * FROM sessions WHERE id = $1', [id]);
    if (!updated) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save board labels',
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: toSessionData(updated),
    } as ApiResponse<Session>);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      } as ApiResponse);
    }
    console.error('Save board labels error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save board labels',
    } as ApiResponse);
  }
});

// Save board state (positions + board drawings)
router.patch('/:id/board-state', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const boardState = boardStateSchema.parse(req.body);

    const session = await queryOne<{ owner_id: string }>(
      'SELECT owner_id FROM sessions WHERE id = $1',
      [id]
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      } as ApiResponse);
    }

    const canManageBoard = await canManageSessionBoard(session.owner_id, userId);
    if (!canManageBoard) {
      return res.status(403).json({
        success: false,
        error: 'Only session owner or assistant can change board state',
      } as ApiResponse);
    }

    await query(
      'UPDATE sessions SET board_state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(boardState), id]
    );

    const updated = await queryOne<any>('SELECT * FROM sessions WHERE id = $1', [id]);
    if (!updated) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save board state',
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: toSessionData(updated),
    } as ApiResponse<Session>);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0].message,
      } as ApiResponse);
    }
    console.error('Save board state error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save board state',
    } as ApiResponse);
  }
});

// Delete session
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;

    // Check ownership
    const session = await queryOne<any>(
      'SELECT owner_id FROM sessions WHERE id = $1',
      [id]
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      } as ApiResponse);
    }

    if (session.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      } as ApiResponse);
    }

    await query('DELETE FROM drawings WHERE session_id = $1', [id]);
    await query('DELETE FROM session_participants WHERE session_id = $1', [id]);
    await query('DELETE FROM sessions WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Session deleted',
    } as ApiResponse);
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session',
    } as ApiResponse);
  }
});

export default router;
