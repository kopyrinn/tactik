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
function getUserSessionsKey(userId: string) {
  return `user:sessions:${userId}`;
}

export async function addUserActiveSession(userId: string, token: string) {
  const key = getUserSessionsKey(userId);
  const raw = await storeGet(key);
  const tokens: string[] = raw ? JSON.parse(raw) : [];
  if (!tokens.includes(token)) tokens.push(token);
  await storeSet(key, JSON.stringify(tokens));
}

export async function removeUserActiveSession(userId: string, token: string) {
  const key = getUserSessionsKey(userId);
  const raw = await storeGet(key);
  if (!raw) return;
  const tokens: string[] = JSON.parse(raw).filter((t: string) => t !== token);
  await storeSet(key, JSON.stringify(tokens));
}

export async function countUserActiveSessions(userId: string): Promise<number> {
  const key = getUserSessionsKey(userId);
  const raw = await storeGet(key);
  if (!raw) return 0;

  const tokens: string[] = JSON.parse(raw);
  const aliveChecks = await Promise.all(
    tokens.map((token) => storeExists(`user:session:${token}`))
  );
  const alive = tokens.filter((_, i) => aliveChecks[i]);

  await storeSet(key, JSON.stringify(alive));
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
  const raw = await storeGet(key);
  if (raw) {
    try {
      const tokens: string[] = JSON.parse(raw);
      await Promise.all(tokens.map((token) => storeDel(`user:session:${token}`)));
    } catch {}
  }
  await storeDel(key);
}

// ---------------------------------------------------------------------------
// Legacy — kept for compatibility
// ---------------------------------------------------------------------------
export function getRedis() {
  return redis;
}
