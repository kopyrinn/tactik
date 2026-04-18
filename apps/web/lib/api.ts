import axios from 'axios';
import type { User, Session, ApiResponse, BoardPieceLabels, BoardState } from './types';

const DEFAULT_API_URL = 'http://localhost:3001';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function resolveBackendBaseUrl() {
  const envUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();

  if (typeof window === 'undefined') {
    return trimTrailingSlash(envUrl || DEFAULT_API_URL);
  }

  const browserHost = window.location.hostname;
  const browserProtocol = window.location.protocol;
  const browserIsLoopback = LOOPBACK_HOSTS.has(browserHost);

  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      const targetIsLoopback = LOOPBACK_HOSTS.has(parsed.hostname);

      // If app is opened from another device (phone) and env still points to localhost,
      // swap host to current page host so requests go to the same machine.
      if (targetIsLoopback && !browserIsLoopback) {
        const port = parsed.port || '3001';
        const path = parsed.pathname === '/' ? '' : parsed.pathname;
        return trimTrailingSlash(`${parsed.protocol}//${browserHost}:${port}${path}`);
      }

      return trimTrailingSlash(parsed.toString());
    } catch {
      return trimTrailingSlash(envUrl);
    }
  }

  return `${browserProtocol}//${browserHost}:3001`;
}

// Create axios instance
const api = axios.create({
  baseURL: resolveBackendBaseUrl(),
  withCredentials: true, // Send cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = typeof error.config?.url === 'string' ? error.config.url : '';
      const isAuthProbeRequest = requestUrl.includes('/api/auth/me') || requestUrl.endsWith('/auth/me');
      const isAdminProbeRequest = requestUrl.includes('/api/admin/me') || requestUrl.endsWith('/admin/me');
      const isAdminRequest = requestUrl.includes('/api/admin/');

      // Unauthorized - redirect to login (skip silent auth probe calls)
      if (typeof window !== 'undefined' && !isAuthProbeRequest && !isAdminProbeRequest) {
        const pathname = window.location.pathname;
        const onAdminPage = pathname.startsWith('/admin');

        if (isAdminRequest || onAdminPage) {
          if (!pathname.startsWith('/admin/login')) {
            window.location.href = '/admin/login';
          }
        } else if (!pathname.includes('/auth')) {
          window.location.href = '/auth/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: async (email: string, password: string, name?: string) => {
    const response = await api.post<ApiResponse<{ user: User }>>(
      '/api/auth/register',
      { email, password, name }
    );
    return response.data;
  },

  login: async (login: string, password: string) => {
    const response = await api.post<ApiResponse<{ user: User }>>(
      '/api/auth/login',
      { login, password }
    );
    return response.data;
  },

  logout: async () => {
    const response = await api.post<ApiResponse>('/api/auth/logout');
    return response.data;
  },

  presence: async (active = true) => {
    const response = await api.post<ApiResponse<{ active: boolean }>>('/api/auth/presence', { active });
    return response.data;
  },

  me: async () => {
    const response = await api.get<ApiResponse<User>>('/api/auth/me');
    return response.data;
  },
};

// Sessions API
export const sessionsApi = {
  list: async () => {
    const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
    return response.data;
  },

  get: async (id: string) => {
    const response = await api.get<ApiResponse<Session>>(`/api/sessions/${id}`);
    return response.data;
  },

  getPublic: async (id: string) => {
    const response = await api.get<ApiResponse<Session>>(`/api/sessions/public/${id}`);
    return response.data;
  },

  create: async (name: string, youtubeUrl: string) => {
    const response = await api.post<ApiResponse<Session>>('/api/sessions', {
      name,
      youtubeUrl,
    });
    return response.data;
  },

  updateBoardLabels: async (id: string, boardPieceLabels: BoardPieceLabels) => {
    const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/board-labels`, boardPieceLabels);
    return response.data;
  },

  updateBoardState: async (id: string, boardState: BoardState) => {
    const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/board-state`, boardState);
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete<ApiResponse>(`/api/sessions/${id}`);
    return response.data;
  },
};

// Demo API
export const demoApi = {
  start: async (): Promise<{ expiresAt: string; login: string; user: User }> => {
    const response = await api.post<ApiResponse<{ expiresAt: string; login: string; user: User }>>('/api/demo/start');
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to start demo');
    }
    return response.data.data;
  },
};

// User API
export const userApi = {
  getProfile: async () => {
    const response = await api.get<ApiResponse<User>>('/api/user/profile');
    return response.data;
  },

  updateProfile: async (data: { name?: string; avatarUrl?: string }) => {
    const response = await api.patch<ApiResponse<User>>('/api/user/profile', data);
    return response.data;
  },

  getUsage: async () => {
    const response = await api.get<ApiResponse<any>>('/api/user/usage');
    return response.data;
  },
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  coach_owner_id: string | null;
  coach_login: string | null;
  subscription_status: string;
  created_at: string;
  // live stats
  is_online: boolean;
  active_devices: number;
  active_sessions: number;
  live_sessions: number;
  live_participants_total: number;
  live_participants_guests: number;
  live_participants_authenticated: number;
  // custom overrides (null = use plan default)
  max_devices_override: number | null;
  max_sessions_override: number | null;
  max_participants_override: number | null;
};

export type AdminUserInput = {
  login: string;
  password?: string;
  name?: string;
  plan?: string;
  coach_owner_id?: string | null;
  copy_password_from_coach?: boolean;
  max_devices_override?: number | null;
  max_sessions_override?: number | null;
  max_participants_override?: number | null;
};

export type AdminDemoLiveSession = {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string | null;
  youtubeUrl: string;
  youtubeVideoId: string;
  maxParticipants: number;
  onlineParticipants: number;
  demoExpiresAt: string | null;
  secondsLeft: number;
  createdAt: string;
  currentVideoTime: number | null;
  isPlaying: boolean;
};

export type AdminDemoOverview = {
  generatedAt: string;
  live: {
    activeDemoUsers: number;
    activeDemoSessions: number;
    listedDemoSessions: number;
    liveSessionLimit: number;
    activeDemoParticipants: number;
    sessions: AdminDemoLiveSession[];
  };
  totals: {
    starts: number;
    sessionsCreated: number;
    participantJoins: number;
  };
  today: {
    day: string;
    starts: number;
    sessionsCreated: number;
    participantJoins: number;
  };
  last7Days: Array<{
    day: string;
    starts: number;
    sessionsCreated: number;
    participantJoins: number;
  }>;
};

export type AdminSessionParticipantSnapshot = {
  userId: string;
  role: 'owner' | 'drawer' | 'viewer';
  joinedAt: string | null;
  isGuest: boolean;
};

export type AdminSessionsOverview = {
  generatedAt: string;
  summary: {
    totalActiveSessions: number;
    listedSessions: number;
    sessionsWithParticipants: number;
    participantsOnline: number;
    guestParticipantsOnline: number;
    authenticatedParticipantsOnline: number;
    activeOwnerDevices: number;
  };
  owners: Array<{
    ownerId: string;
    ownerEmail: string | null;
    ownerName: string | null;
    ownerActiveDevices: number;
    sessionsTotal: number;
    sessionsLive: number;
    participantsTotal: number;
    participantsGuests: number;
    participantsAuthenticated: number;
  }>;
  sessions: Array<{
    id: string;
    name: string;
    ownerId: string;
    ownerEmail: string | null;
    ownerName: string | null;
    ownerActiveDevices: number;
    youtubeUrl: string;
    youtubeVideoId: string;
    maxParticipants: number;
    isDemo: boolean;
    isActive: boolean;
    demoExpiresAt: string | null;
    secondsLeft: number | null;
    createdAt: string;
    updatedAt: string;
    boardOpen: boolean;
    currentVideoTime: number | null;
    isPlaying: boolean;
    participants: {
      total: number;
      authenticated: number;
      guests: number;
      users: AdminSessionParticipantSnapshot[];
    };
  }>;
  meta: {
    limit: number;
    total: number;
    truncated: boolean;
  };
};

export type AdminUserSessionsStats = {
  generatedAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    plan: string;
    createdAt: string;
  };
  summary: {
    ownerActiveDevices: number;
    totalSessions: number;
    activeSessions: number;
    demoSessions: number;
    storedDrawings: number;
    liveSessions: number;
    liveParticipantsTotal: number;
    liveParticipantsAuthenticated: number;
    liveParticipantsGuests: number;
  };
  recentSessions: Array<{
    id: string;
    name: string;
    youtubeUrl: string;
    youtubeVideoId: string;
    maxParticipants: number;
    isDemo: boolean;
    isActive: boolean;
    demoExpiresAt: string | null;
    secondsLeft: number | null;
    createdAt: string;
    updatedAt: string;
    storedDrawings: number;
    live: {
      participantsTotal: number;
      participantsAuthenticated: number;
      participantsGuests: number;
      boardOpen: boolean;
      currentVideoTime: number | null;
      isPlaying: boolean;
    };
  }>;
  last7Days: Array<{
    day: string;
    sessionsCreated: number;
  }>;
};

export type AdminErrorLogEntry = {
  id: number;
  timestamp: string;
  source: string;
  message: string;
  stack: string | null;
  details: string | null;
};

export type AdminErrorLogsPayload = {
  generatedAt: string;
  summary: {
    totalStored: number;
    windowMinutes: number;
    inWindowCount: number;
    bySource: Array<{
      source: string;
      count: number;
    }>;
  };
  entries: AdminErrorLogEntry[];
};

export const adminApi = {
  login: async (login: string, password: string) => {
    const response = await api.post<ApiResponse>('/api/admin/login', { login, password });
    return response.data;
  },

  me: async () => {
    const response = await api.get<ApiResponse<{ authenticated: boolean }>>('/api/admin/me');
    return response.data;
  },

  logout: async () => {
    const response = await api.post<ApiResponse>('/api/admin/logout');
    return response.data;
  },

  getUsers: async () => {
    const response = await api.get<ApiResponse<AdminUser[]>>('/api/admin/users');
    return response.data;
  },

  getDemoOverview: async () => {
    const response = await api.get<ApiResponse<AdminDemoOverview>>('/api/admin/demo/overview');
    return response.data;
  },

  getSessionsOverview: async (limit = 300) => {
    const response = await api.get<ApiResponse<AdminSessionsOverview>>('/api/admin/sessions/overview', {
      params: { limit },
    });
    return response.data;
  },

  getUserSessionsStats: async (userId: string, limit = 120) => {
    const response = await api.get<ApiResponse<AdminUserSessionsStats>>(`/api/admin/users/${userId}/sessions/stats`, {
      params: { limit },
    });
    return response.data;
  },

  getErrorLogs: async (limit = 200, windowMinutes = 60) => {
    const response = await api.get<ApiResponse<AdminErrorLogsPayload>>('/api/admin/errors', {
      params: { limit, windowMinutes },
    });
    return response.data;
  },

  clearErrorLogs: async () => {
    const response = await api.post<ApiResponse>('/api/admin/errors/clear');
    return response.data;
  },

  resetDemoMetrics: async (scope: 'all' | 'today' = 'all') => {
    const response = await api.post<ApiResponse<{ scope: 'all' | 'today' }>>('/api/admin/demo/reset', { scope });
    return response.data;
  },

  createUser: async (data: AdminUserInput) => {
    const response = await api.post<ApiResponse<AdminUser>>('/api/admin/users', data);
    return response.data;
  },

  updateUser: async (id: string, data: Partial<AdminUserInput>) => {
    const response = await api.patch<ApiResponse<AdminUser>>(`/api/admin/users/${id}`, data);
    return response.data;
  },

  deleteUser: async (id: string) => {
    const response = await api.delete<ApiResponse>(`/api/admin/users/${id}`);
    return response.data;
  },
};

export default api;
