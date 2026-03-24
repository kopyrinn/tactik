import type { Request } from 'express';
import { query, queryOne } from '../db';
import { deleteAllUserSessions, deleteUserSession, getUserFromSession, removeUserActiveSession } from '../redis';
import { deleteSessionWithArtifacts } from './deleteSession';

export function getAuthTokenFromRequest(req: Pick<Request, 'cookies' | 'headers'>): string | null {
  const cookieToken = typeof req.cookies?.auth_token === 'string' ? req.cookies.auth_token : null;
  if (cookieToken) return cookieToken;

  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : null;
  if (!authHeader) return null;

  return authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim() || null
    : null;
}

export async function revokeAuthTokenSession(
  token: string | null | undefined,
  options: { cleanupDemoUser?: boolean } = {}
): Promise<{ userId: string | null; isDemoUser: boolean }> {
  if (!token) {
    return { userId: null, isDemoUser: false };
  }

  const userId = await getUserFromSession(token);
  if (!userId) {
    await deleteUserSession(token);
    return { userId: null, isDemoUser: false };
  }

  const currentUser = options.cleanupDemoUser
    ? await queryOne<{ is_demo_user: number | null }>(
      'SELECT is_demo_user FROM users WHERE id = $1',
      [userId]
    )
    : null;
  const isDemoUser = currentUser?.is_demo_user === 1;

  await removeUserActiveSession(userId, token);
  await deleteUserSession(token);

  if (isDemoUser && options.cleanupDemoUser) {
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

  return { userId, isDemoUser };
}
