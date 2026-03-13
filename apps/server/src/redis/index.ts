// In-memory storage as Redis replacement for local development
const store = new Map<string, { value: string; expiresAt?: number }>();

export async function initRedis() {
  console.log('✅ Using in-memory session storage (development mode)');
  return store;
}

export function getRedis() {
  return {
    setex: async (key: string, ttl: number, value: string) => {
      store.set(key, {
        value,
        expiresAt: Date.now() + ttl * 1000,
      });
      return 'OK';
    },
    
    get: async (key: string): Promise<string | null> => {
      const item = store.get(key);
      if (!item) return null;
      
      if (item.expiresAt && Date.now() > item.expiresAt) {
        store.delete(key);
        return null;
      }
      
      return item.value;
    },
    
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },

    ping: async () => 'PONG',
  };
}

// Session state management
export async function saveSessionState(sessionId: string, state: any) {
  store.set(`session:${sessionId}`, {
    value: JSON.stringify(state),
    expiresAt: Date.now() + 3600 * 1000, // 1 hour
  });
}

export async function getSessionState(sessionId: string): Promise<any | null> {
  const item = store.get(`session:${sessionId}`);
  if (!item) return null;
  
  if (item.expiresAt && Date.now() > item.expiresAt) {
    store.delete(`session:${sessionId}`);
    return null;
  }
  
  return JSON.parse(item.value);
}

export async function deleteSessionState(sessionId: string) {
  store.delete(`session:${sessionId}`);
}

// User session tokens
export async function saveUserSession(userId: string, token: string, expiresIn: number = 604800) {
  store.set(`user:session:${token}`, {
    value: userId,
    expiresAt: Date.now() + expiresIn * 1000,
  });
}

export async function getUserFromSession(token: string): Promise<string | null> {
  const item = store.get(`user:session:${token}`);
  if (!item) return null;

  if (item.expiresAt && Date.now() > item.expiresAt) {
    store.delete(`user:session:${token}`);
    return null;
  }

  return item.value;
}

export async function deleteUserSession(token: string) {
  store.delete(`user:session:${token}`);
}

// Concurrent device tracking per user
function getUserSessionsKey(userId: string) {
  return `user:sessions:${userId}`;
}

export async function addUserActiveSession(userId: string, token: string) {
  const key = getUserSessionsKey(userId);
  const existing = store.get(key);
  const tokens: string[] = existing ? JSON.parse(existing.value) : [];
  if (!tokens.includes(token)) tokens.push(token);
  store.set(key, { value: JSON.stringify(tokens) });
}

export async function removeUserActiveSession(userId: string, token: string) {
  const key = getUserSessionsKey(userId);
  const existing = store.get(key);
  if (!existing) return;
  const tokens: string[] = JSON.parse(existing.value).filter((t: string) => t !== token);
  store.set(key, { value: JSON.stringify(tokens) });
}

export async function countUserActiveSessions(userId: string): Promise<number> {
  const key = getUserSessionsKey(userId);
  const existing = store.get(key);
  if (!existing) return 0;

  const tokens: string[] = JSON.parse(existing.value);
  // Filter only tokens that are still alive in the session store
  const alive = tokens.filter((token) => {
    const sess = store.get(`user:session:${token}`);
    if (!sess) return false;
    if (sess.expiresAt && Date.now() > sess.expiresAt) return false;
    return true;
  });

  // Update stored list to remove expired tokens
  store.set(key, { value: JSON.stringify(alive) });
  return alive.length;
}

export async function countUserActiveSessionsBulk(userIds: string[]): Promise<Record<string, number>> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const counts: Record<string, number> = {};

  for (const userId of uniqueUserIds) {
    counts[userId] = await countUserActiveSessions(userId);
  }

  return counts;
}

export async function deleteAllUserSessions(userId: string) {
  const key = getUserSessionsKey(userId);
  const existing = store.get(key);
  if (existing) {
    try {
      const tokens: string[] = JSON.parse(existing.value);
      tokens.forEach((token) => {
        store.delete(`user:session:${token}`);
      });
    } catch {}
  }
  store.delete(key);
}

// Cleanup expired items every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of store.entries()) {
    if (item.expiresAt && now > item.expiresAt) {
      store.delete(key);
    }
  }
}, 60000);
