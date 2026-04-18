import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// In-memory fallback (development / no REDIS_URL)
// ---------------------------------------------------------------------------
const memStore = new Map<string, { value: string; expiresAt?: number }>();

function memSet(key: string, value: string, ttlSeconds?: number) {
  memStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
  });
}

function memGet(key: string): string | null {
  const item = memStore.get(key);
  if (!item) return null;
  if (item.expiresAt && Date.now() > item.expiresAt) {
    memStore.delete(key);
    return null;
  }
  return item.value;
}

function memDel(key: string) {
  memStore.delete(key);
}

// ---------------------------------------------------------------------------
// Redis client (production)
// ---------------------------------------------------------------------------
let redis: Redis | null = null;

export async function initRedis() {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    console.log('Redis connected');
  } else {
    console.log('Using in-memory session storage (development mode)');

    // Cleanup expired items every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of memStore.entries()) {
        if (item.expiresAt && now > item.expiresAt) {
          memStore.delete(key);
        }
      }
    }, 60_000);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function storeSet(key: string, value: string, ttlSeconds?: number) {
  if (redis) {
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, value);
    } else {
      await redis.set(key, value);
    }
  } else {
    memSet(key, value, ttlSeconds);
  }
}

async function storeGet(key: string): Promise<string | null> {
  if (redis) return redis.get(key);
  return memGet(key);
}

async function storeDel(key: string) {
  if (redis) await redis.del(key);
  else memDel(key);
}

async function storeExists(key: string): Promise<boolean> {
  if (redis) return (await redis.exists(key)) === 1;
  return memGet(key) !== null;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------
export async function saveSessionState(sessionId: string, state: any) {
  await storeSet(`session:${sessionId}`, JSON.stringify(state), 3600);
}

export async function getSessionState(sessionId: string): Promise<any | null> {
  const raw = await storeGet(`session:${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteSessionState(sessionId: string) {
  await storeDel(`session:${sessionId}`);
}

// ---------------------------------------------------------------------------
// User auth tokens
// ---------------------------------------------------------------------------
export async function saveUserSession(userId: string, token: string, expiresIn = 604800) {
  await storeSet(`user:session:${token}`, userId, expiresIn);
}

export async function getUserFromSession(token: string): Promise<string | null> {
  return storeGet(`user:session:${token}`);
}

export async function deleteUserSession(token: string) {
  await storeDel(`user:session:${token}`);
}

// ---------------------------------------------------------------------------
// Active device tracking per user (stored as JSON array of tokens)
// ---------------------------------------------------------------------------
const ACTIVE_SESSION_TTL_SECONDS = 5 * 60;

function getUserSessionsKey(userId: string) {
  return `user:sessions:${userId}`;
}

function getUserActiveSessionKey(token: string) {
  return `user:session:active:${token}`;
}

function parseUserSessionTokens(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return [...new Set(
      parsed.filter((token): token is string => typeof token === 'string' && token.length > 0)
    )];
  } catch {
    return [];
  }
}

export async function addUserActiveSession(userId: string, token: string) {
  const key = getUserSessionsKey(userId);
  const tokens = parseUserSessionTokens(await storeGet(key));
  if (!tokens.includes(token)) tokens.push(token);
  await Promise.all([
    storeSet(key, JSON.stringify(tokens)),
    storeSet(getUserActiveSessionKey(token), '1', ACTIVE_SESSION_TTL_SECONDS),
  ]);
}

export async function refreshUserActiveSession(userId: string, token: string) {
  await addUserActiveSession(userId, token);
}

export async function removeUserActiveSession(userId: string, token: string) {
  const key = getUserSessionsKey(userId);
  const tokens = parseUserSessionTokens(await storeGet(key)).filter((value) => value !== token);

  await Promise.all([
    tokens.length > 0
      ? storeSet(key, JSON.stringify(tokens))
      : storeDel(key),
    storeDel(getUserActiveSessionKey(token)),
  ]);
}

export async function countUserActiveSessions(userId: string): Promise<number> {
  const key = getUserSessionsKey(userId);
  const tokens = parseUserSessionTokens(await storeGet(key));
  if (tokens.length === 0) {
    await storeDel(key);
    return 0;
  }

  const aliveChecks = await Promise.all(
    tokens.map(async (token) => {
      const [hasAuthSession, hasActivePresence] = await Promise.all([
        storeExists(`user:session:${token}`),
        storeExists(getUserActiveSessionKey(token)),
      ]);

      return hasAuthSession && hasActivePresence;
    })
  );
  const alive = tokens.filter((_, i) => aliveChecks[i]);

  if (alive.length > 0) {
    await storeSet(key, JSON.stringify(alive));
  } else {
    await storeDel(key);
  }

  return alive.length;
}

export async function countUserActiveSessionsBulk(userIds: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const counts: Record<string, number> = {};
  await Promise.all(unique.map(async (userId) => {
    counts[userId] = await countUserActiveSessions(userId);
  }));
  return counts;
}

export async function deleteAllUserSessions(userId: string) {
  const key = getUserSessionsKey(userId);
  const tokens = parseUserSessionTokens(await storeGet(key));
  if (tokens.length > 0) {
    await Promise.all(tokens.flatMap((token) => [
      storeDel(`user:session:${token}`),
      storeDel(getUserActiveSessionKey(token)),
    ]));
  }
  await storeDel(key);
}

// ---------------------------------------------------------------------------
// Legacy — kept for compatibility
// ---------------------------------------------------------------------------
export function getRedis() {
  return redis;
}
