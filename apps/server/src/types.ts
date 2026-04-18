// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  plan: 'free' | 'coach' | 'pro';
  coachOwnerId?: string | null;
  subscriptionStatus: 'inactive' | 'active' | 'cancelled' | 'expired';
  subscriptionEndDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreateInput {
  email: string;
  password: string;
  name?: string;
}

export interface UserLoginInput {
  email: string;
  password: string;
}

// Session types
export interface BoardPieceLabelItem {
  id: string;
  label: string;
}

export interface BoardPieceLabels {
  red: BoardPieceLabelItem[];
  yellow: BoardPieceLabelItem[];
}

export interface BoardStatePiecePosition {
  id: string;
  x: number;
  y: number;
}

export interface BoardState {
  pieces: BoardStatePiecePosition[];
  drawings: Array<Array<{ x: number; y: number }>>;
}

export interface Session {
  id: string;
  ownerId: string;
  name: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  qrCode: string | null;
  joinCode: string | null;
  boardPieceLabels: BoardPieceLabels | null;
  boardState: BoardState | null;
  maxParticipants: number;
  isActive: boolean;
  isDemo?: boolean;
  demoExpiresAt?: string | null;
  demoRoomCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionCreateInput {
  name: string;
  youtubeUrl: string;
}

export interface SessionParticipant {
  id: string;
  sessionId: string;
  userId: string;
  color: string;
  role: 'owner' | 'drawer' | 'viewer';
  joinedAt: Date;
  user?: User;
}

// Drawing types
export type DrawingTool = 'arrow' | 'circle' | 'line' | 'freehand' | 'text';

export interface BaseDrawing {
  id: string;
  sessionId: string;
  userId: string;
  videoTimestamp: number;
  tool: DrawingTool;
  color: string;
  createdAt: Date;
}

export interface ArrowDrawing extends BaseDrawing {
  tool: 'arrow';
  data: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    thickness: number;
  };
}

export interface CircleDrawing extends BaseDrawing {
  tool: 'circle';
  data: {
    centerX: number;
    centerY: number;
    radius: number;
    thickness: number;
    filled: boolean;
  };
}

export interface LineDrawing extends BaseDrawing {
  tool: 'line';
  data: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    thickness: number;
  };
}

export interface FreehandDrawing extends BaseDrawing {
  tool: 'freehand';
  data: {
    points: Array<{ x: number; y: number }>;
    thickness: number;
  };
}

export interface TextDrawing extends BaseDrawing {
  tool: 'text';
  data: {
    x: number;
    y: number;
    text: string;
    fontSize: number;
  };
}

export type Drawing = 
  | ArrowDrawing 
  | CircleDrawing 
  | LineDrawing 
  | FreehandDrawing 
  | TextDrawing;

// Video state types
export interface VideoState {
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  lastUpdate: number;
}

export type TimelineMarkerType = 'goal' | 'dismissal' | 'substitution' | 'foul' | 'freeKick' | 'moment';

export interface TimelineMarker {
  id: string;
  time: number;
  type: TimelineMarkerType;
}

// Socket event types
export interface SocketEvents {
  // Session management
  'session:create': (data: SessionCreateInput) => void;
  'session:join': (sessionId: string, userId: string) => void;
  'session:leave': (sessionId: string, userId: string) => void;
  'session:state': (state: SessionState) => void;
  'session:user_joined': (participant: SessionParticipant) => void;
  'session:participant_updated': (participant: SessionParticipant) => void;
  'session:participant_color': (data: { sessionId: string; userId: string; color: string }) => void;
  'session:user_left': (userId: string) => void;

  // Video controls
  'video:play': (time: number) => void;
  'video:pause': (time: number) => void;
  'video:seek': (time: number) => void;
  'video:sync': (state: VideoState) => void;

  // Drawing
  'draw:start': (data: Partial<Drawing>) => void;
  'draw:update': (data: Partial<Drawing>) => void;
  'draw:end': (data: Drawing) => void;
  'draw:undo': (drawingId: string) => void;
  'draw:clear': () => void;
  'draw:broadcast': (drawing: Drawing) => void;
  'draw:history': (drawings: Drawing[]) => void;
  'board:state': (state: BoardState) => void;
  'board:visibility': (state: { isOpen: boolean }) => void;
  'timeline:state': (markers: TimelineMarker[]) => void;

  // Errors
  'error': (message: string) => void;
}

// Session state (in-memory on server)
export interface SessionState {
  id: string;
  participants: SessionParticipant[];
  videoState: VideoState;
  drawings: Drawing[];
  boardState: BoardState | null;
  boardOpen: boolean;
  timelineMarkers: TimelineMarker[];
  owner: User;
}

// Subscription types
export interface Subscription {
  id: string;
  userId: string;
  plan: 'free' | 'coach' | 'pro';
  status: 'active' | 'cancelled' | 'expired';
  paymentProvider: 'kaspi' | 'cloudpayments' | 'stripe';
  externalSubscriptionId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Plan limits
export interface PlanLimits {
  maxSessions: number;
  maxParticipants: number;
  maxRooms: number;
  sessionDuration: number | null; // null = unlimited
  hasWatermark: boolean;
  hasCustomBranding: boolean;
}

export const PLAN_LIMITS: Record<User['plan'], PlanLimits> = {
  free: {
    maxSessions: 1,
    maxParticipants: 2,
    maxRooms: 1,
    sessionDuration: 180, // 3 minutes
    hasWatermark: true,
    hasCustomBranding: false,
  },
  coach: {
    maxSessions: -1, // unlimited
    maxParticipants: 4,
    maxRooms: 1,
    sessionDuration: null,
    hasWatermark: false,
    hasCustomBranding: false,
  },
  pro: {
    maxSessions: -1,
    maxParticipants: 6,
    maxRooms: 4,
    sessionDuration: null,
    hasWatermark: false,
    hasCustomBranding: true,
  },
};

// API response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Usage tracking
export interface UsageLog {
  id: string;
  userId: string | null;
  sessionId: string | null;
  action: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface UsageStats {
  sessionsCreated: number;
  drawingsCreated: number;
  totalDuration: number;
  lastActivity: Date | null;
}
