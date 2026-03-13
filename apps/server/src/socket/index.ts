import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { SessionState, Drawing, VideoState, SessionParticipant, BoardState, BoardPieceLabels } from '../types';
import { getSessionState, saveSessionState } from '../redis';
import { incrementDemoMetric, query, queryOne } from '../db';
import { generateId } from '../db';

// In-memory session state management
const activeSessions = new Map<string, SessionState>();
const FALLBACK_DRAWING_COLOR = '#FF0000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

type LiveParticipantSnapshot = {
  userId: string;
  role: SessionParticipant['role'];
  joinedAt: string | null;
  isGuest: boolean;
};

type LiveSessionSnapshot = {
  sessionId: string;
  ownerId: string | null;
  participantCount: number;
  guestCount: number;
  authenticatedCount: number;
  participants: LiveParticipantSnapshot[];
  boardOpen: boolean;
  videoState: VideoState;
};

export function getLiveSessionParticipantCounts() {
  const counts: Record<string, number> = {};
  for (const [sessionId, state] of activeSessions.entries()) {
    counts[sessionId] = state.participants.length;
  }
  return counts;
}

export function getLiveSessionVideoSnapshots() {
  const snapshots: Record<string, VideoState> = {};
  for (const [sessionId, state] of activeSessions.entries()) {
    snapshots[sessionId] = getProjectedVideoState(state.videoState);
  }
  return snapshots;
}

export function getLiveSessionSnapshots(): Record<string, LiveSessionSnapshot> {
  const snapshots: Record<string, LiveSessionSnapshot> = {};

  for (const [sessionId, state] of activeSessions.entries()) {
    const ownerId = typeof (state as any).owner === 'string'
      ? (state as any).owner
      : (state as any).owner?.id || null;

    const participants = (state.participants || []).map((participant) => {
      const userId = String(participant.userId || '');
      const isGuest = /^guest-/i.test(userId);
      const joinedAtValue = participant.joinedAt instanceof Date
        ? participant.joinedAt.toISOString()
        : (typeof participant.joinedAt === 'string' ? participant.joinedAt : null);

      return {
        userId,
        role: participant.role,
        joinedAt: joinedAtValue,
        isGuest,
      };
    });

    const guestCount = participants.filter((participant) => participant.isGuest).length;
    const participantCount = participants.length;

    snapshots[sessionId] = {
      sessionId,
      ownerId,
      participantCount,
      guestCount,
      authenticatedCount: Math.max(0, participantCount - guestCount),
      participants,
      boardOpen: Boolean((state as any).boardOpen),
      videoState: getProjectedVideoState(state.videoState),
    };
  }

  return snapshots;
}

type DrawingRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  video_timestamp: number;
  tool: string;
  data: string;
  created_at: string;
};

function isValidBoardPieceLabels(value: unknown): value is BoardPieceLabels {
  if (!value || typeof value !== 'object') return false;
  const data = value as { red?: unknown; yellow?: unknown };
  if (!Array.isArray(data.red) || !Array.isArray(data.yellow)) return false;
  if (data.red.length !== 11 || data.yellow.length !== 11) return false;

  const isLabelItem = (item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as { id?: unknown; label?: unknown };
    if (typeof row.id !== 'string' || !/^[ry]-\d+$/.test(row.id)) return false;
    if (typeof row.label !== 'string') return false;
    return row.label.trim().length <= 3;
  };

  return data.red.every(isLabelItem) && data.yellow.every(isLabelItem);
}

function parseDrawingRow(row: DrawingRow): Drawing {
  let parsedData: any = null;
  try {
    parsedData = JSON.parse(row.data);
  } catch {
    parsedData = null;
  }

  // New format: full drawing object serialized in `drawings.data`.
  if (parsedData && typeof parsedData === 'object' && parsedData.data && parsedData.tool) {
    return {
      ...parsedData,
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id || parsedData.userId || 'unknown',
      videoTimestamp: Number(row.video_timestamp || parsedData.videoTimestamp || 0),
      tool: parsedData.tool || row.tool,
      color: parsedData.color || FALLBACK_DRAWING_COLOR,
      createdAt: parsedData.createdAt || row.created_at,
    } as Drawing;
  }

  // Legacy format: only drawing payload was stored in `data`.
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id || 'unknown',
    videoTimestamp: Number(row.video_timestamp || 0),
    tool: row.tool as Drawing['tool'],
    color: FALLBACK_DRAWING_COLOR,
    createdAt: row.created_at as any,
    data: parsedData && typeof parsedData === 'object' ? parsedData : {},
  } as Drawing;
}

function parseBoardState(rawValue: unknown): BoardState | null {
  if (!rawValue || typeof rawValue !== 'string') return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') return null;

    const pieces = Array.isArray((parsed as any).pieces) ? (parsed as any).pieces : [];
    const drawings = Array.isArray((parsed as any).drawings) ? (parsed as any).drawings : [];
    return { pieces, drawings } as BoardState;
  } catch {
    return null;
  }
}

function getProjectedVideoState(videoState: VideoState): VideoState {
  const now = Date.now();
  const playbackRate = Number(videoState.playbackRate) > 0 ? Number(videoState.playbackRate) : 1;
  const currentTime = Number(videoState.currentTime) || 0;
  const lastUpdate = Number(videoState.lastUpdate) || now;

  if (!videoState.isPlaying) {
    return {
      ...videoState,
      currentTime,
      playbackRate,
      lastUpdate,
    };
  }

  const elapsedSeconds = Math.max(0, (now - lastUpdate) / 1000);
  return {
    ...videoState,
    currentTime: currentTime + elapsedSeconds * playbackRate,
    playbackRate,
    lastUpdate: now,
  };
}

function getCookieValue(rawCookie: string | undefined, key: string): string | null {
  if (!rawCookie) return null;

  const chunks = rawCookie.split(';');
  for (const chunk of chunks) {
    const [name, ...rest] = chunk.trim().split('=');
    if (name === key) {
      const value = rest.join('=');
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

function normalizeDemoGuestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^guest-[a-z0-9_-]{4,64}$/i.test(normalized)) return null;
  return normalized;
}

async function resolveAuthenticatedSocketUserId(socket: Socket): Promise<string | null> {
  const cookieToken = getCookieValue(socket.handshake.headers.cookie, 'auth_token');
  const authTokenFromPayload = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
  const authHeader = typeof socket.handshake.headers.authorization === 'string' ? socket.handshake.headers.authorization : null;
  const bearerToken = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const token = cookieToken || authTokenFromPayload || bearerToken;

  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
    const userId = typeof decoded?.userId === 'string' ? decoded.userId : null;
    if (!userId) return null;

    const existingUser = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);
    return existingUser?.id || null;
  } catch {
    return null;
  }
}

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);
    const joinedSessions = new Map<string, {
      mode: 'display' | 'participant';
      userId: string;
      canModerateSession: boolean;
      isDemoSession: boolean;
    }>();
    const resolveStateOwnerId = (state: SessionState): string | null => {
      const owner = (state as any).owner;
      if (typeof owner === 'string') return owner;
      if (owner && typeof owner.id === 'string') return owner.id;
      return null;
    };

    // Join session
    socket.on(
      'session:join',
      async (data: { sessionId: string; userId: string; color: string; mode?: 'display' | 'participant' }) => {
      try {
        const { sessionId, color } = data;
        const isDisplayClient = data.mode === 'display';

        // Validate session exists
        const session = await queryOne<any>(
          'SELECT * FROM sessions WHERE id = $1 AND is_active = true',
          [sessionId]
        );

        if (!session) {
          socket.emit('error', 'Session not found or inactive');
          return;
        }

        const authenticatedUserId = await resolveAuthenticatedSocketUserId(socket);
        const isDemoSession = (session as any).is_demo === 1;
        const demoExpired = isDemoSession && (session as any).demo_expires_at
          && new Date((session as any).demo_expires_at) < new Date();

        if (isDemoSession && demoExpired) {
          socket.emit('error', 'Demo session has expired');
          return;
        }

        if (!isDisplayClient && !authenticatedUserId && !isDemoSession) {
          socket.emit('error', 'Authentication required for participant mode');
          return;
        }
        const requestedDemoGuestId = isDemoSession ? normalizeDemoGuestId(data.userId) : null;
        const participantUserId = authenticatedUserId || requestedDemoGuestId || `guest-${socket.id}`;
        let canModerateSession = false;

        if (!isDisplayClient && isDemoSession) {
          // Demo sessions are collaborative by design: allow all connected participants
          // to moderate board actions and full-canvas operations.
          canModerateSession = true;
        } else if (!isDisplayClient && authenticatedUserId) {
          if (authenticatedUserId === session.owner_id) {
            canModerateSession = true;
          } else {
            const currentUser = await queryOne<{ coach_owner_id: string | null }>(
              'SELECT coach_owner_id FROM users WHERE id = $1',
              [authenticatedUserId]
            );
            canModerateSession = currentUser?.coach_owner_id === session.owner_id;
          }
        }

        if (!isDisplayClient && authenticatedUserId && !isDemoSession) {
          await query(
            `INSERT INTO session_participants (session_id, user_id, color, role)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (session_id, user_id) DO UPDATE SET color = $3`,
            [sessionId, authenticatedUserId, color, 'drawer']
          );
        }

        // Join socket room
        socket.join(sessionId);
        joinedSessions.set(sessionId, {
          mode: isDisplayClient ? 'display' : 'participant',
          userId: participantUserId,
          canModerateSession,
          isDemoSession,
        });

        // Get or create session state
        let state: SessionState | undefined = activeSessions.get(sessionId);
        if (!state) {
          const dbBoardState = parseBoardState((session as any).board_state);

          // Load from Redis or create new
          const savedState = (await getSessionState(sessionId)) as SessionState | null;
          if (savedState) {
            state = {
              ...savedState,
              boardState: (savedState as any).boardState ?? dbBoardState ?? null,
              boardOpen: Boolean((savedState as any).boardOpen),
            };
          } else {
            const restoredDrawings = isDemoSession
              ? []
              : (
                await query<DrawingRow>(
                  `SELECT id, session_id, user_id, video_timestamp, tool, data, created_at
                   FROM drawings
                   WHERE session_id = $1
                   ORDER BY created_at ASC`,
                  [sessionId]
                )
              ).map(parseDrawingRow);

            state = {
              id: sessionId,
              participants: [],
              videoState: {
                currentTime: 0,
                isPlaying: false,
                playbackRate: 1,
                lastUpdate: Date.now(),
              },
              drawings: restoredDrawings,
              boardState: dbBoardState,
              boardOpen: false,
              owner: session.owner_id,
            };
          }
          activeSessions.set(sessionId, state);
        }

        if (!state) {
          socket.emit('error', 'Failed to initialize session state');
          return;
        }

        if (!isDisplayClient) {
          const alreadyJoined = state.participants.some((participant) => participant.userId === participantUserId);
          if (!alreadyJoined && state.participants.length >= session.max_participants) {
            socket.leave(sessionId);
            socket.emit('error', 'Session is full');
            return;
          }
        }

        const syncedVideoState = getProjectedVideoState(state.videoState);
        state.videoState = syncedVideoState;

        // Send current state snapshot to new participant
        socket.emit('session:state', {
          ...state,
          videoState: syncedVideoState,
        });

        if (isDisplayClient) {
          console.log(`Display connected to session ${sessionId}`);
          return;
        }

        // Add participant to state
        const participant: SessionParticipant = {
          id: socket.id,
          sessionId,
          userId: participantUserId,
          color,
          role: session.owner_id === participantUserId ? 'owner' : 'drawer',
          joinedAt: new Date(),
        };

        // Prevent duplicate participants for the same user in dev reconnect/strict-mode cases.
        const existingParticipantIndex = state.participants.findIndex(
          (p) => p.userId === participantUserId || p.id === socket.id
        );
        const isNewParticipantJoin = existingParticipantIndex < 0;
        if (existingParticipantIndex >= 0) {
          state.participants[existingParticipantIndex] = participant;
        } else {
          state.participants.push(participant);
        }

        if (isDemoSession && isNewParticipantJoin) {
          incrementDemoMetric('participantJoins');
        }

        // Notify others
        socket.to(sessionId).emit('session:user_joined', participant);

        console.log(`User ${participantUserId} joined session ${sessionId}`);

        // Save state to Redis
        await saveSessionState(sessionId, state);
      } catch (error) {
        console.error('Error joining session:', error);
        socket.emit('error', 'Failed to join session');
      }
    });

    // Leave session
    socket.on('session:leave', async (sessionId: string) => {
      try {
        joinedSessions.delete(sessionId);
        const state = activeSessions.get(sessionId);
        if (state) {
          const participant = state.participants.find(p => p.id === socket.id);
          if (participant) {
            state.participants = state.participants.filter(p => p.id !== socket.id);
            socket.to(sessionId).emit('session:user_left', participant.userId);

            // If no participants left, clean up
            if (state.participants.length === 0) {
              activeSessions.delete(sessionId);
            } else {
              await saveSessionState(sessionId, state);
            }
          }
        }

        socket.leave(sessionId);
        console.log(`Socket ${socket.id} left session ${sessionId}`);
      } catch (error) {
        console.error('Error leaving session:', error);
      }
    });

    // Video controls
    socket.on('video:play', (data: { sessionId: string; time: number }) => {
      const access = joinedSessions.get(data.sessionId);
      if (!access || access.mode !== 'participant') return;
      const state = activeSessions.get(data.sessionId);
      if (state) {
        state.videoState.isPlaying = true;
        state.videoState.currentTime = data.time;
        state.videoState.lastUpdate = Date.now();

        socket.to(data.sessionId).emit('video:sync', state.videoState);
        saveSessionState(data.sessionId, state);
      }
    });

    socket.on('video:pause', (data: { sessionId: string; time: number }) => {
      const access = joinedSessions.get(data.sessionId);
      if (!access || access.mode !== 'participant') return;
      const state = activeSessions.get(data.sessionId);
      if (state) {
        state.videoState.isPlaying = false;
        state.videoState.currentTime = data.time;
        state.videoState.lastUpdate = Date.now();

        socket.to(data.sessionId).emit('video:sync', state.videoState);
        saveSessionState(data.sessionId, state);
      }
    });

    socket.on('video:seek', (data: { sessionId: string; time: number }) => {
      const access = joinedSessions.get(data.sessionId);
      if (!access || access.mode !== 'participant') return;
      const state = activeSessions.get(data.sessionId);
      if (state) {
        state.videoState.currentTime = data.time;
        state.videoState.lastUpdate = Date.now();

        socket.to(data.sessionId).emit('video:sync', state.videoState);
        saveSessionState(data.sessionId, state);
      }
    });

    // Drawing events
    socket.on('draw:start', (data: { sessionId: string; drawing: Partial<Drawing> }) => {
      const access = joinedSessions.get(data.sessionId);
      if (!access || access.mode !== 'participant') return;
      const drawing = { ...data.drawing, userId: access.userId };
      // Broadcast to others
      socket.to(data.sessionId).emit('draw:broadcast', drawing);
    });

    socket.on('draw:update', (data: { sessionId: string; drawing: Partial<Drawing> }) => {
      const access = joinedSessions.get(data.sessionId);
      if (!access || access.mode !== 'participant') return;
      const drawing = { ...data.drawing, userId: access.userId };
      // Broadcast to others
      socket.to(data.sessionId).emit('draw:broadcast', drawing);
    });

    socket.on('draw:end', async (data: { sessionId: string; drawing: Drawing }) => {
      try {
        const access = joinedSessions.get(data.sessionId);
        if (!access || access.mode !== 'participant') return;

        const state = activeSessions.get(data.sessionId);
        if (state) {
          const drawingId = data.drawing.id || generateId();
          const drawingToSave = {
            ...data.drawing,
            id: drawingId,
            sessionId: data.sessionId,
            userId: access.userId,
          };

          // Add to state
          state.drawings.push(drawingToSave);

          if (!access.isDemoSession) {
            // Persist only non-demo sessions.
            await query(
              `INSERT INTO drawings (id, session_id, user_id, video_timestamp, tool, data) 
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                drawingId,
                data.sessionId,
                drawingToSave.userId,
                drawingToSave.videoTimestamp,
                drawingToSave.tool,
                JSON.stringify(drawingToSave),
              ]
            );
          }

          // Broadcast to others
          socket.to(data.sessionId).emit('draw:broadcast', drawingToSave);

          // Save state
          await saveSessionState(data.sessionId, state);
        }
      } catch (error) {
        console.error('Error saving drawing:', error);
        socket.emit('error', 'Failed to save drawing');
      }
    });

    socket.on('draw:undo', async (data: { sessionId: string; drawingId: string }) => {
      try {
        const access = joinedSessions.get(data.sessionId);
        if (!access || access.mode !== 'participant') return;

        const state = activeSessions.get(data.sessionId);
        if (state) {
          const targetDrawing = state.drawings.find((d) => d.id === data.drawingId);
          if (!targetDrawing) return;

          const isOwner = resolveStateOwnerId(state) === access.userId;
          if (!isOwner && targetDrawing.userId !== access.userId) {
            return;
          }

          state.drawings = state.drawings.filter(d => d.id !== data.drawingId);

          if (!access.isDemoSession) {
            await query('DELETE FROM drawings WHERE id = $1', [data.drawingId]);
          }

          socket.to(data.sessionId).emit('draw:undo', data.drawingId);
          await saveSessionState(data.sessionId, state);
        }
      } catch (error) {
        console.error('Error undoing drawing:', error);
      }
    });

    socket.on('draw:clear', async (data: { sessionId: string }) => {
      try {
        const access = joinedSessions.get(data.sessionId);
        if (!access || access.mode !== 'participant') return;

        const state = activeSessions.get(data.sessionId);
        if (state) {
          if (!access.canModerateSession) return;

          state.drawings = [];

          if (!access.isDemoSession) {
            await query('DELETE FROM drawings WHERE session_id = $1', [data.sessionId]);
          }

          socket.to(data.sessionId).emit('draw:clear');
          await saveSessionState(data.sessionId, state);
        }
      } catch (error) {
        console.error('Error clearing drawings:', error);
      }
    });

    socket.on('board:labels', async (data: { sessionId: string; boardPieceLabels: BoardPieceLabels }) => {
      try {
        const access = joinedSessions.get(data.sessionId);
        if (!access || access.mode !== 'participant') return;
        if (!access.canModerateSession) return;
        if (!isValidBoardPieceLabels(data.boardPieceLabels)) return;

        socket.to(data.sessionId).emit('board:labels', data.boardPieceLabels);
      } catch (error) {
        console.error('Error syncing board labels:', error);
      }
    });

    socket.on('board:state', async (data: { sessionId: string; boardState: BoardState }) => {
      try {
        const access = joinedSessions.get(data.sessionId);
        if (!access || access.mode !== 'participant') return;

        const state = activeSessions.get(data.sessionId);
        if (!state) return;
        if (!access.canModerateSession) return;

        state.boardState = data.boardState;
        socket.to(data.sessionId).emit('board:state', data.boardState);
        await saveSessionState(data.sessionId, state);
      } catch (error) {
        console.error('Error syncing board state:', error);
      }
    });

    socket.on('board:visibility', async (data: { sessionId: string; isOpen: boolean }) => {
      try {
        const access = joinedSessions.get(data.sessionId);
        if (!access || access.mode !== 'participant') return;

        const state = activeSessions.get(data.sessionId);
        if (!state) return;
        if (!access.canModerateSession) return;

        state.boardOpen = Boolean(data.isOpen);
        socket.to(data.sessionId).emit('board:visibility', { isOpen: state.boardOpen });
        await saveSessionState(data.sessionId, state);
      } catch (error) {
        console.error('Error syncing board visibility:', error);
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);

      // Clean up from all sessions
      activeSessions.forEach((state, sessionId) => {
        const participant = state.participants.find(p => p.id === socket.id);
        if (participant) {
          state.participants = state.participants.filter(p => p.id !== socket.id);
          socket.to(sessionId).emit('session:user_left', participant.userId);

          if (state.participants.length === 0) {
            activeSessions.delete(sessionId);
          } else {
            saveSessionState(sessionId, state);
          }
        }
      });
    });
  });
}
