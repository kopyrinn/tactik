'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import YouTube, { YouTubeEvent } from 'react-youtube';
import { io, Socket } from 'socket.io-client';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Circle, Maximize2, Minimize2, Pause, PencilLine, Play, Redo2, Slash, Trash2, Type, Undo2, Volume2, VolumeX } from 'lucide-react';
import { resolveBackendBaseUrl, sessionsApi } from '@/lib/api';
import { setDemoAuthMarker } from '@/lib/constants/demo';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUiStore } from '@/lib/stores/uiStore';
import { useInactivityLogout } from '@/lib/hooks/useInactivityLogout';
import type { BoardPieceLabels, BoardState, Session } from '@/lib/types';

type DrawTool = 'freehand' | 'arrow' | 'circle' | 'line' | 'text';
type TimelineTone = 'cyan' | 'gold' | 'red';
type TimelineMarkerType = 'goal' | 'dismissal' | 'substitution' | 'foul' | 'freeKick';

type TimelineMarker = {
  id: string;
  time: number;
  type: TimelineMarkerType;
};

type TimelineMenuState = {
  time: number;
  leftPercent: number;
  markerId: string | null;
};

type FreehandData = {
  points: Array<{ x: number; y: number }>;
  thickness: number;
};

type ArrowData = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  thickness: number;
};

type LineData = ArrowData;

type CircleData = {
  centerX: number;
  centerY: number;
  radius: number;
  thickness: number;
  filled?: boolean;
};

type TextData = {
  x: number;
  y: number;
  text: string;
  fontSize: number;
};

type DrawingPayload = FreehandData | ArrowData | LineData | CircleData | TextData;
type CoordinateSpace = 'canvas' | 'video';
type FrameBox = { left: number; top: number; width: number; height: number };

type SessionDrawing = {
  id: string;
  sessionId: string;
  userId: string;
  videoTimestamp: number;
  tool: DrawTool;
  color: string;
  coordinateSpace?: CoordinateSpace;
  data: DrawingPayload;
  createdAt: string;
  isDraft?: boolean;
};

type SessionParticipant = {
  id: string;
  sessionId: string;
  userId: string;
  color: string;
  role: 'owner' | 'drawer' | 'viewer';
  joinedAt: string;
};

type VideoSyncState = {
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
};

type SessionStatePayload = {
  participants?: SessionParticipant[];
  drawings?: SessionDrawing[];
  videoState?: VideoSyncState;
  boardState?: BoardState | null;
  boardOpen?: boolean;
};

type BoardTeam = 'red' | 'yellow' | 'ball';

type BoardPiece = {
  id: string;
  label: string;
  x: number;
  y: number;
  team: BoardTeam;
};

type BoardPath = Array<{ x: number; y: number }>;

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type DemoSessionInfo = {
  sessionId: string;
  expiresAt: string;
  guestId: string;
};

const PARTICIPANT_COLORS = ['#FF4D6D', '#39F3FF', '#8CFF3F', '#FFD447', '#FF7A29', '#8C63FF', '#FF4FE1', '#3F88FF', '#00F5A0', '#FF6363'];
const DEFAULT_COLOR = PARTICIPANT_COLORS[0];
const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2];
const TARGET_VIDEO_ASPECT_RATIO = 16 / 9;
const LAST_SESSION_STORAGE_KEY = 'tactik:last-session-id';
const BOARD_PIECE_RADIUS = 0.03;
const BOARD_SYNC_INTERVAL_MS = 120;
const BOARD_DRAW_POINT_STEP = 0.0016;
const BOARD_VISIBILITY_LOCK_MS = 450;
const TOOL_OPTIONS: Array<{ tool: DrawTool; shortcut: string }> = [
  { tool: 'freehand', shortcut: 'B' },
  { tool: 'arrow', shortcut: 'A' },
  { tool: 'circle', shortcut: 'C' },
  { tool: 'line', shortcut: 'L' },
  { tool: 'text', shortcut: 'T' },
];
const MOBILE_SHAPE_TOOLS: DrawTool[] = ['arrow', 'circle', 'line'];
const MOBILE_SHAPE_TOOL_SET = new Set<DrawTool>(MOBILE_SHAPE_TOOLS);
const QUALITY_PRIORITY = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
const QUALITY_LABELS: Record<string, string> = {
  highres: '8K',
  hd2160: '4K',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
};
const DEMO_FALLBACK_DURATION_MS = 5 * 60 * 1000;
const YOUTUBE_RELATED_CLOSE_ZONE = {
  minX: 0.962,
  maxX: 0.995,
  minY: 0.615,
  maxY: 0.715,
};
const YOUTUBE_RELATED_PASSTHROUGH_MS = 900;
const COMPACT_TOUCH_MAX_SHORT_SIDE_PX = 699;
const TIMELINE_MARKER_HOLD_MS = 600;
const TIMELINE_TRACK_INSET_PX = 8;
const TIMELINE_MARKER_TYPES: TimelineMarkerType[] = ['goal', 'dismissal', 'substitution', 'foul', 'freeKick'];
const getTimelineAlignedLeft = (percent: number, offsetPx = 0) => {
  const fraction = clamp(percent, 0, 100) / 100;
  const offset =
    offsetPx === 0 ? '' : offsetPx > 0 ? ` + ${offsetPx}px` : ` - ${Math.abs(offsetPx)}px`;
  return `calc(${TIMELINE_TRACK_INSET_PX}px + (100% - ${TIMELINE_TRACK_INSET_PX * 2}px) * ${fraction}${offset})`;
};
const getTimelineAlignedPercent = (clientX: number, rect: { left: number; width: number }) => {
  const usableWidth = Math.max(rect.width - TIMELINE_TRACK_INSET_PX * 2, 1);
  const alignedX = clamp(clientX - rect.left - TIMELINE_TRACK_INSET_PX, 0, usableWidth);
  return (alignedX / usableWidth) * 100;
};
const DECORATIVE_TIMELINE_COLUMNS: Array<{ position: number; height: number; tone: TimelineTone }> = Array.from(
  { length: 56 },
  (_, index) => {
    let tone: TimelineTone = 'cyan';
    if (index % 14 === 0) tone = 'gold';
    else if (index % 9 === 0) tone = 'red';

    return {
      position: (index / 55) * 100,
      height: 2 + (index % 2),
      tone,
    };
  }
);
const TIMELINE_TONE_STYLE: Record<TimelineTone, { active: string; inactive: string; glow: string }> = {
  cyan: {
    active: '#69f7e5',
    inactive: 'rgba(105,247,229,0.32)',
    glow: 'rgba(105,247,229,0.55)',
  },
  gold: {
    active: '#d8c05e',
    inactive: 'rgba(216,192,94,0.34)',
    glow: 'rgba(216,192,94,0.45)',
  },
  red: {
    active: '#ff6f7a',
    inactive: 'rgba(255,111,122,0.34)',
    glow: 'rgba(255,111,122,0.42)',
  },
};
const TIMELINE_MARKER_STYLE: Record<TimelineMarkerType, { color: string; glow: string }> = {
  goal: {
    color: '#d8c05e',
    glow: 'rgba(216,192,94,0.5)',
  },
  dismissal: {
    color: '#ff6f7a',
    glow: 'rgba(255,111,122,0.45)',
  },
  substitution: {
    color: '#69f7e5',
    glow: 'rgba(105,247,229,0.5)',
  },
  foul: {
    color: '#f7c63d',
    glow: 'rgba(247,198,61,0.45)',
  },
  freeKick: {
    color: '#6e88ff',
    glow: 'rgba(110,136,255,0.5)',
  },
};

function TimelineMarkerIcon({ type, color }: { type: TimelineMarkerType; color: string }) {
  if (type === 'goal') {
    return (
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none" className="pointer-events-none">
        <circle cx="10" cy="10" r="9.1" fill="#708894" />
        <path d="M7.8 2.15h4.4l1.45 2.65-1.75 2.6H8.05L6.3 4.8 7.8 2.15Z" fill="#f1f5fa" stroke="#050607" strokeWidth="0.7" />
        <path d="M2.55 4.75 6.3 4.8l1.75 2.6-.95 3.5-3.55 1.4L1.2 9.15 1.55 6.2Z" fill="#edf2f8" stroke="#050607" strokeWidth="0.7" />
        <path d="M13.7 4.8 17.45 4.75l1.05 2.2-.35 3.1-3.6 1.25-1.6-3.9Z" fill="#edf2f8" stroke="#050607" strokeWidth="0.7" />
        <path d="M8.1 7.4h3.8l1.55 3.6L10 13.55 6.55 11Z" fill="#556d7b" stroke="#050607" strokeWidth="0.7" />
        <path d="M3.55 12.3 6.55 11 10 13.55v3.65L6.7 18.55 3.1 16.1Z" fill="#eef3f9" stroke="#050607" strokeWidth="0.7" />
        <path d="M10 13.55 13.45 11l3.4 1.15-.2 3.7-3.4 2.65-3.25-1.3Z" fill="#eef3f9" stroke="#050607" strokeWidth="0.7" />
        <path d="M13.25 1.95c2.7.95 4.8 3.2 5.55 5.95M17.05 15.95A8.9 8.9 0 0 1 13.2 18.5M2.2 11.3a8.85 8.85 0 0 0 2.05 5.15" stroke="#dce5ee" strokeWidth="0.85" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }
  if (type === 'dismissal') {
    return (
      <svg width="17" height="22" viewBox="0 0 14 18" fill="none" className="pointer-events-none">
        <rect x="1.1" y="1.1" width="11.8" height="15.8" rx="2.2" fill="#ff5d6c" stroke="#ffd7db" strokeWidth="1.1" />
      </svg>
    );
  }
  if (type === 'substitution') {
    return (
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none">
        <path
          d="M2.1 2.4h2.2l0.75 0.65h2.05l0.8 0.85-.3 2.2-1.1-.28v4.2H2.9V6.86l-1.1.3-.28-2.24.58-.54Z"
          fill="#ff5a5f"
          stroke="#39080e"
          strokeWidth="0.6"
        />
        <path d="M3.85 4.25h1.55l-0.8 2.15" stroke="#39080e" strokeWidth="0.95" />
        <path
          d="M10.75 2.95h3.15v-0.7l4.1 3.55-4.1 3.5V8.6h-3.15V2.95Z"
          fill="#ff5a5f"
          stroke="#39080e"
          strokeWidth="0.6"
        />
        <path
          d="M9.45 17.55h2.2l0.75-.65h2.05l0.8-.85-.3-2.2-1.1.28v-4.2h-3.6v4.22l-1.1-.3-.28 2.24.58.54Z"
          fill="#4ef07a"
          stroke="#052611"
          strokeWidth="0.6"
        />
        <rect x="11.45" y="11.2" width="0.78" height="2.95" rx="0.36" fill="#052611" />
        <rect x="12.95" y="11.2" width="0.78" height="2.95" rx="0.36" fill="#052611" />
        <path
          d="M9.25 11.45H6.1v0.7L2 8.6l4.1-3.55v0.7h3.15v5.7Z"
          fill="#4ef07a"
          stroke="#052611"
          strokeWidth="0.6"
        />
      </svg>
    );
  }
  if (type === 'foul') {
    return (
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none" className="pointer-events-none">
        <rect
          x="2.9"
          y="4.2"
          width="9.2"
          height="13.1"
          rx="1.7"
          fill="#f7c63d"
          transform="rotate(-21 2.9 4.2)"
        />
        <rect
          x="4.6"
          y="5.7"
          width="8.6"
          height="12.2"
          rx="1.5"
          fill="#e7ab0a"
          opacity="0.55"
          transform="rotate(-21 4.6 5.7)"
        />
        <rect
          x="9.1"
          y="2.7"
          width="9.7"
          height="13.8"
          rx="1.9"
          fill="#ff3a3a"
          transform="rotate(16 9.1 2.7)"
        />
        <rect
          x="9.6"
          y="3.2"
          width="8.9"
          height="12.9"
          rx="1.6"
          fill="#ff4b4b"
          opacity="0.88"
          transform="rotate(16 9.6 3.2)"
        />
      </svg>
    );
  }
  if (type === 'freeKick') {
    return (
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none" className="pointer-events-none">
        <path
          d="M0.9 7.15c0-0.7 0.58-1.28 1.28-1.28h6.2c3.56 0 6.06 1.15 7.87 3.54l0.67 0.9c0.48 0.63 0.75 1.4 0.75 2.2 0 2-1.62 3.62-3.62 3.62h-1.65a3.2 3.2 0 0 1-3-2.1l-0.22-0.65a2.5 2.5 0 0 0-2.37-1.7H2.18c-0.7 0-1.28-0.58-1.28-1.28V7.15Z"
          fill="#e25357"
        />
        <path
          d="M1 7.15c0-0.71 0.57-1.28 1.28-1.28h6.1c3.38 0 5.77 1.03 7.56 3.18H2.28C1.57 9.05 1 8.37 1 7.15Z"
          fill="#f7b2b4"
          opacity="0.9"
        />
        <circle cx="9.55" cy="5.75" r="1.08" fill="#06080b" />
        <circle cx="14.25" cy="11.95" r="4.25" fill="#e85f61" />
        <circle cx="14.25" cy="11.95" r="3.35" fill="#0d1533" />
        <circle cx="14.25" cy="11.95" r="2.68" fill="#ece6df" />
        <path d="M14.25 9.58 15.28 10.3l-.4 1.28h-1.26l-.4-1.28 1.03-.72Z" fill="#121417" />
        <path d="M12.48 10.02 13.18 9.66l.52 0.7-0.18 1.42-1.02 0.64-0.9-0.48 0.2-1.33 0.68-0.59Z" fill="#3f74d7" />
        <path d="M15.32 10.35 15.96 9.68l1.1 0.27 0.34 1.13-0.55 0.9-1.32-0.25-0.22-1.38Z" fill="#3f74d7" />
        <path d="M12.82 13.02h2.84l0.4 1.02-0.88 0.88h-1.86l-0.9-0.88 0.4-1.02Z" fill="#3f74d7" />
        <circle cx="18.75" cy="7.15" r="0.34" fill="#9f2d27" />
      </svg>
    );
  }
  return null;
}

const VIDEO_INTERACTION_SURFACE_STYLE: React.CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  WebkitTapHighlightColor: 'transparent',
  touchAction: 'manipulation',
};

const VIDEO_DRAW_CANVAS_STYLE: React.CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  WebkitTapHighlightColor: 'transparent',
  touchAction: 'none',
};

function createInitialBoardPieces(): BoardPiece[] {
  const redFormation: Array<[number, number]> = [
    [0.08, 0.5],
    [0.2, 0.18],
    [0.2, 0.38],
    [0.2, 0.62],
    [0.2, 0.82],
    [0.36, 0.26],
    [0.36, 0.5],
    [0.36, 0.74],
    [0.52, 0.2],
    [0.52, 0.5],
    [0.52, 0.8],
  ];

  const yellowFormation: Array<[number, number]> = redFormation.map(([x, y]) => [1 - x, y]);

  const redPieces = redFormation.map(([x, y], index) => ({
    id: `r-${index + 1}`,
    label: `${index + 1}`,
    x,
    y,
    team: 'red' as const,
  }));

  const yellowPieces = yellowFormation.map(([x, y], index) => ({
    id: `y-${index + 1}`,
    label: `${index + 1}`,
    x,
    y,
    team: 'yellow' as const,
  }));

  const ball: BoardPiece = {
    id: 'ball',
    label: 'o',
    x: 0.5,
    y: 0.5,
    team: 'ball',
  };

  return [...redPieces, ...yellowPieces, ball];
}

function resetBoardPiecePositions(pieces: BoardPiece[]): BoardPiece[] {
  const initialMap = new Map(createInitialBoardPieces().map((piece) => [piece.id, piece]));
  return pieces.map((piece) => {
    const initial = initialMap.get(piece.id);
    if (!initial) return piece;
    return {
      ...piece,
      x: initial.x,
      y: initial.y,
    };
  });
}

function toBoardPieceLabels(pieces: BoardPiece[]): BoardPieceLabels {
  const sortById = (left: BoardPiece, right: BoardPiece) => {
    const leftValue = Number(left.id.split('-')[1] || 0);
    const rightValue = Number(right.id.split('-')[1] || 0);
    return leftValue - rightValue;
  };

  const mapToItem = (piece: BoardPiece) => ({
    id: piece.id,
    label: piece.label.trim().slice(0, 3),
  });

  return {
    red: pieces
      .filter((piece) => piece.team === 'red')
      .sort(sortById)
      .map(mapToItem),
    yellow: pieces
      .filter((piece) => piece.team === 'yellow')
      .sort(sortById)
      .map(mapToItem),
  };
}

function applyBoardPieceLabels(basePieces: BoardPiece[], labels: BoardPieceLabels | null | undefined): BoardPiece[] {
  if (!labels) return basePieces;

  const labelsMap = new Map<string, string>();
  labels.red.forEach((item) => labelsMap.set(item.id, item.label));
  labels.yellow.forEach((item) => labelsMap.set(item.id, item.label));

  return basePieces.map((piece) => {
    if (!labelsMap.has(piece.id) || piece.team === 'ball') return piece;
    const label = labelsMap.get(piece.id) ?? '';
    return { ...piece, label: label.slice(0, 3) };
  });
}

function toBoardState(pieces: BoardPiece[], drawings: BoardPath[]): BoardState {
  return {
    pieces: pieces.map((piece) => ({
      id: piece.id,
      x: piece.x,
      y: piece.y,
    })),
    drawings: drawings.map((path) => path.map((point) => ({ x: point.x, y: point.y }))),
  };
}

function applyBoardState(basePieces: BoardPiece[], state: BoardState | null | undefined): { pieces: BoardPiece[]; drawings: BoardPath[] } {
  if (!state) {
    return { pieces: basePieces, drawings: [] };
  }

  const positionMap = new Map(state.pieces.map((piece) => [piece.id, piece]));
  const nextPieces = basePieces.map((piece) => {
    const position = positionMap.get(piece.id);
    if (!position) return piece;
    return {
      ...piece,
      x: clamp(position.x, BOARD_PIECE_RADIUS, 1 - BOARD_PIECE_RADIUS),
      y: clamp(position.y, BOARD_PIECE_RADIUS, 1 - BOARD_PIECE_RADIUS),
    };
  });

  const nextDrawings = state.drawings
    .filter((path) => Array.isArray(path) && path.length >= 2)
    .map((path) => path.map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) })));

  return {
    pieces: nextPieces,
    drawings: nextDrawings,
  };
}

type SessionLocaleText = {
  loadingSession: string;
  sessionIdMissing: string;
  sessionNotFound: string;
  failedToLoadSession: string;
  enterLabel: string;
  sessionNotAvailable: string;
  retry: string;
  backToDashboard: string;
  loginRequired: string;
  loginRequiredText: string;
  signIn: string;
  createAccount: string;
  session: string;
  users: string;
  exit: string;
  viewer: string;
  fullscreen: string;
  exitFullscreen: string;
  canvasOn: string;
  canvasOff: string;
  canvasToggleTitle: string;
  hideControls: string;
  showControls: string;
  play: string;
  pause: string;
  undo: string;
  redo: string;
  clearAll: string;
  thickness: string;
  joinQr: string;
  qrNotAvailable: string;
  copyJoinLink: string;
  participants: string;
  noParticipants: string;
  participantPencilColor: string;
  participantPencilColorHint: string;
  displayMode: string;
  displayModeHint: string;
  openDisplay: string;
  copyDisplayLink: string;
  toolFreehand: string;
  toolArrow: string;
  toolCircle: string;
  toolLine: string;
  toolText: string;
  roleOwner: string;
  roleDrawer: string;
  roleViewer: string;
  undoHint: string;
  redoHint: string;
  quality: string;
  qualityAuto: string;
  qualityMax: string;
  coachUiTitle: string;
  coachUiSubtitle: string;
  sectionVideo: string;
  sectionDrawing: string;
  sectionSession: string;
  speed: string;
  board: string;
  closeBoard: string;
  boardMoveMode: string;
  boardGroupMove: string;
  boardGroupMoveOn: string;
  boardClearSelection: string;
  boardDrawMode: string;
  boardEditNumbers: string;
  boardFinishEditNumbers: string;
  boardClearDrawings: string;
  boardReset: string;
  boardHint: string;
  boardNumberPrompt: string;
  teamRed: string;
  teamYellow: string;
  timelineGoal: string;
  timelineDismissal: string;
  timelineSubstitution: string;
  timelineFoul: string;
  timelineFreeKick: string;
  timelineMarkersButton: string;
  timelineEditorTitle: string;
  timelineEditorEmpty: string;
  timelineDelete: string;
  timelineDeleteAll: string;
  closeModal: string;
  videoErrorInvalid: string;
  videoErrorPlayback: string;
  videoErrorNotFound: string;
  videoErrorEmbedBlocked: string;
  videoErrorGeneric: string;
};

const SESSION_TEXT: Record<'ru' | 'kk', SessionLocaleText> = {
  ru: {
    loadingSession: 'Загрузка сессии...',
    sessionIdMissing: 'ID сессии не указан',
    sessionNotFound: 'Сессия не найдена',
    failedToLoadSession: 'Не удалось загрузить сессию',
    enterLabel: 'Введите подпись',
    sessionNotAvailable: 'Сессия недоступна',
    retry: 'Повторить',
    backToDashboard: 'Назад в кабинет',
    loginRequired: 'Нужен вход',
    loginRequiredText: 'Чтобы стать полноценным участником сессии, войдите в аккаунт.',
    signIn: 'Войти',
    createAccount: 'Создать аккаунт',
    session: 'Сессия',
    users: 'Пользователи',
    exit: 'Выйти',
    viewer: 'зритель',
    fullscreen: 'Полный экран',
    exitFullscreen: 'Выйти из полного экрана',
    canvasOn: 'Рисовать ВКЛ',
    canvasOff: 'Рисовать ВЫКЛ',
    canvasToggleTitle: 'Включить или выключить режим рисования поверх видео',
    hideControls: 'Скрыть панель',
    showControls: 'Показать панель',
    play: 'Пуск',
    pause: 'Пауза',
    undo: 'Отменить',
    redo: 'Повторить',
    clearAll: 'Очистить всё',
    thickness: 'Толщина',
    joinQr: 'QR для входа',
    qrNotAvailable: 'QR недоступен',
    copyJoinLink: 'Копировать ссылку входа',
    participants: 'Участники',
    noParticipants: 'Пока нет участников',
    participantPencilColor: 'Цвет карандаша',
    participantPencilColorHint: 'Нажмите на цвет участника, чтобы выбрать яркий цвет его карандаша.',
    displayMode: 'Экран показа',
    displayModeHint: 'Открыть отдельный полноэкранный экран без панели управления.',
    openDisplay: 'Открыть экран',
    copyDisplayLink: 'Копировать ссылку экрана',
    toolFreehand: 'Карандаш',
    toolArrow: 'Стрелка',
    toolCircle: 'Круг',
    toolLine: 'Линия',
    toolText: 'Текст',
    roleOwner: 'владелец',
    roleDrawer: 'рисует',
    roleViewer: 'смотрит',
    undoHint: 'Отменить (Ctrl/Cmd+Z)',
    redoHint: 'Повторить (Ctrl/Cmd+Shift+Z или Ctrl/Cmd+Y)',
    quality: 'Качество',
    qualityAuto: 'Авто',
    qualityMax: 'Максимум',
    coachUiTitle: 'Понятная панель тренера',
    coachUiSubtitle: 'Шаг 1: управляйте видео. Шаг 2: выберите инструмент и рисуйте. Шаг 3: делитесь с участниками.',
    sectionVideo: '1. Видео',
    sectionDrawing: '2. Рисование',
    sectionSession: '3. Сессия',
    speed: 'Скорость',
    board: 'Доска',
    closeBoard: 'Закрыть доску',
    boardMoveMode: 'Двигать фишки',
    boardGroupMove: 'Выделить фишки',
    boardGroupMoveOn: 'Выделение ВКЛ',
    boardClearSelection: 'Снять выделение',
    boardDrawMode: 'Рисовать',
    boardEditNumbers: 'Изменить номера',
    boardFinishEditNumbers: 'Готово: номера',
    boardClearDrawings: 'Очистить рисунок',
    boardReset: 'Сбросить фишки',
    boardHint: 'Режим тактики: перемещайте фишки и рисуйте поверх поля.',
    boardNumberPrompt: 'Номер фишки',
    teamRed: 'Красная команда',
    teamYellow: 'Желтая команда',
    timelineGoal: 'Гол',
    timelineDismissal: 'Удаление',
    timelineSubstitution: 'Замена',
    timelineFoul: 'Нарушение',
    timelineFreeKick: 'Штрафной удар',
    timelineMarkersButton: 'Метки',
    timelineEditorTitle: 'Редактор меток',
    timelineEditorEmpty: 'Пока нет добавленных меток.',
    timelineDelete: 'Удалить',
    timelineDeleteAll: 'Удалить все',
    closeModal: 'Закрыть',
    videoErrorInvalid: 'Ошибка видео: некорректный YouTube ID или ссылка.',
    videoErrorPlayback: 'Ошибка видео на устройстве. Попробуйте обновить страницу.',
    videoErrorNotFound: 'Видео недоступно: удалено или закрыто автором.',
    videoErrorEmbedBlocked: 'Автор запретил встраивание этого видео на сторонние сайты.',
    videoErrorGeneric: 'Ошибка загрузки YouTube-видео',
  },
  kk: {
    loadingSession: 'Сессия жүктелуде...',
    sessionIdMissing: 'Сессия ID көрсетілмеген',
    sessionNotFound: 'Сессия табылмады',
    failedToLoadSession: 'Сессияны жүктеу мүмкін болмады',
    enterLabel: 'Жазуды енгізіңіз',
    sessionNotAvailable: 'Сессия қолжетімсіз',
    retry: 'Қайта көру',
    backToDashboard: 'Кабинетке оралу',
    loginRequired: 'Кіру қажет',
    loginRequiredText: 'Сессияға толық қатысушы болу үшін аккаунтқа кіріңіз.',
    signIn: 'Кіру',
    createAccount: 'Аккаунт ашу',
    session: 'Сессия',
    users: 'Қолданушылар',
    exit: 'Шығу',
    viewer: 'көрермен',
    fullscreen: 'Толық экран',
    exitFullscreen: 'Толық экраннан шығу',
    canvasOn: 'Сызу ҚОСУЛЫ',
    canvasOff: 'Сызу ӨШІРУЛІ',
    canvasToggleTitle: 'Видео үстінде сызу режимін қосу немесе өшіру',
    hideControls: 'Панельді жасыру',
    showControls: 'Панельді көрсету',
    play: 'Ойнату',
    pause: 'Тоқтату',
    undo: 'Болдырмау',
    redo: 'Қайталау',
    clearAll: 'Барлығын өшіру',
    thickness: 'Қалыңдық',
    joinQr: 'Қосылу QR',
    qrNotAvailable: 'QR қолжетімсіз',
    copyJoinLink: 'Қосылу сілтемесін көшіру',
    participants: 'Қатысушылар',
    noParticipants: 'Қатысушылар әлі жоқ',
    participantPencilColor: 'Қарындаш түсі',
    participantPencilColorHint: 'Қатысушының түсін басып, оның қарындашына ашық түсті таңдаңыз.',
    displayMode: 'Көрсету режимі',
    displayModeHint: 'Басқару панелінсіз бөлек толық экранды көрсетуді ашу.',
    openDisplay: 'Экранды ашу',
    copyDisplayLink: 'Экран сілтемесін көшіру',
    toolFreehand: 'Қарындаш',
    toolArrow: 'Көрсеткі',
    toolCircle: 'Шеңбер',
    toolLine: 'Сызық',
    toolText: 'Мәтін',
    roleOwner: 'иесі',
    roleDrawer: 'сурет салады',
    roleViewer: 'қарайды',
    undoHint: 'Болдырмау (Ctrl/Cmd+Z)',
    redoHint: 'Қайталау (Ctrl/Cmd+Shift+Z немесе Ctrl/Cmd+Y)',
    quality: 'Сапа',
    qualityAuto: 'Авто',
    qualityMax: 'Максимум',
    coachUiTitle: 'Жаттықтырушыға ыңғайлы панель',
    coachUiSubtitle: '1-қадам: видеоны басқарыңыз. 2-қадам: құралды таңдап, сызыңыз. 3-қадам: қатысушылармен бөлісіңіз.',
    sectionVideo: '1. Видео',
    sectionDrawing: '2. Сурет салу',
    sectionSession: '3. Сессия',
    speed: 'Жылдамдық',
    board: 'Тақта',
    closeBoard: 'Тақтаны жабу',
    boardMoveMode: 'Фишкаларды жылжыту',
    boardGroupMove: 'Фишкаларды таңдау',
    boardGroupMoveOn: 'Таңдау ҚОСУЛЫ',
    boardClearSelection: 'Таңдауды тазарту',
    boardDrawMode: 'Сызу',
    boardEditNumbers: 'Нөмірді өзгерту',
    boardFinishEditNumbers: 'Дайын: нөмірлер',
    boardClearDrawings: 'Сызбаны тазарту',
    boardReset: 'Фишкаларды қалпына келтіру',
    boardHint: 'Тактика режимі: фишкаларды жылжытып, алаң үстіне сызыңыз.',
    boardNumberPrompt: 'Фишка нөмірі',
    teamRed: 'Қызыл команда',
    teamYellow: 'Сары команда',
    timelineGoal: 'Гол',
    timelineDismissal: 'Алаңнан қуу',
    timelineSubstitution: 'Ауыстыру',
    timelineFoul: 'Ереже бұзу',
    timelineFreeKick: 'Айып соққысы',
    timelineMarkersButton: 'Белгілер',
    timelineEditorTitle: 'Белгі редакторы',
    timelineEditorEmpty: 'Әзірге белгі қосылмаған.',
    timelineDelete: 'Өшіру',
    timelineDeleteAll: 'Барлығын өшіру',
    closeModal: 'Жабу',
    videoErrorInvalid: 'Видео қатесі: YouTube сілтемесі немесе ID қате.',
    videoErrorPlayback: 'Құрылғыда видео қатесі шықты. Бетті жаңартып көріңіз.',
    videoErrorNotFound: 'Видео қолжетімсіз: өшірілген немесе жабық.',
    videoErrorEmbedBlocked: 'Автор бұл видеоны сайт ішінде ашуға рұқсат бермеген.',
    videoErrorGeneric: 'YouTube-видеоны жүктеу қатесі',
  },
};

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getFullscreenElement(doc: FullscreenCapableDocument) {
  return doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
}

function getVideoFrame(width: number, height: number): FrameBox {
  if (width <= 0 || height <= 0) {
    return { left: 0, top: 0, width: Math.max(1, width), height: Math.max(1, height) };
  }

  let frameWidth = width;
  let frameHeight = frameWidth / TARGET_VIDEO_ASPECT_RATIO;

  if (frameHeight > height) {
    frameHeight = height;
    frameWidth = frameHeight * TARGET_VIDEO_ASPECT_RATIO;
  }

  return {
    left: (width - frameWidth) / 2,
    top: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

function ToolIcon({ tool, className = 'w-4 h-4' }: { tool: DrawTool; className?: string }) {
  if (tool === 'freehand') return <PencilLine className={className} strokeWidth={2.2} />;
  if (tool === 'arrow') return <ArrowUpRight className={className} strokeWidth={2.2} />;
  if (tool === 'circle') return <Circle className={className} strokeWidth={2.2} />;
  if (tool === 'line') return <Slash className={className} strokeWidth={2.2} />;
  return <Type className={className} strokeWidth={2.2} />;
}

function shortUserId(value: string) {
  return value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function normalizeParticipantColor(value: unknown, fallback = DEFAULT_COLOR) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function getColorForUser(userId: string, isOwner: boolean) {
  if (isOwner) return PARTICIPANT_COLORS[0];

  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }

  const idx = Math.abs(hash) % (PARTICIPANT_COLORS.length - 1);
  return PARTICIPANT_COLORS[idx + 1];
}

function dedupeParticipants(list: SessionParticipant[]) {
  const map = new Map<string, SessionParticipant>();
  list.forEach((participant) => {
    map.set(participant.userId, {
      ...participant,
      color: normalizeParticipantColor(participant.color),
    });
  });
  return Array.from(map.values());
}

function mergeParticipant(list: SessionParticipant[], participant: SessionParticipant) {
  if (list.some((item) => item.userId === participant.userId)) {
    return dedupeParticipants(list.map((item) => (item.userId === participant.userId ? participant : item)));
  }
  return dedupeParticipants([...list, participant]);
}

function normalizeQualityLevels(levels: unknown): string[] {
  if (!Array.isArray(levels)) return [];

  const unique = new Set<string>();
  levels.forEach((level) => {
    if (typeof level === 'string' && QUALITY_PRIORITY.includes(level)) {
      unique.add(level);
    }
  });

  return Array.from(unique).sort((left, right) => QUALITY_PRIORITY.indexOf(left) - QUALITY_PRIORITY.indexOf(right));
}

function getTopQualityLevel(levels: string[]): string | null {
  if (levels.length === 0) return null;
  return levels[0];
}

function createDemoGuestId() {
  return `guest-${Math.random().toString(36).slice(2, 10)}`;
}

function formatSecondsToClock(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function normalizeTimelineMarkers(value: unknown): TimelineMarker[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Partial<TimelineMarker> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : createId(),
      time: Number.isFinite(item.time) ? Math.max(0, Number(item.time)) : 0,
      type: item.type === 'goal' || item.type === 'dismissal' || item.type === 'substitution' || item.type === 'foul'
        ? item.type
        : 'foul',
    }))
    .sort((left, right) => left.time - right.time);
}

function getDemoSecondsLeft(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
}

function isInYoutubeRelatedCloseZone(
  event: React.PointerEvent<HTMLCanvasElement>,
  container: HTMLDivElement | null
) {
  if (!container) return false;
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const relativeX = (event.clientX - rect.left) / rect.width;
  const relativeY = (event.clientY - rect.top) / rect.height;

  return (
    relativeX >= YOUTUBE_RELATED_CLOSE_ZONE.minX
    && relativeX <= YOUTUBE_RELATED_CLOSE_ZONE.maxX
    && relativeY >= YOUTUBE_RELATED_CLOSE_ZONE.minY
    && relativeY <= YOUTUBE_RELATED_CLOSE_ZONE.maxY
  );
}

function getYoutubeErrorMessage(code: number, text: SessionLocaleText) {
  if (code === 2) return text.videoErrorInvalid;
  if (code === 5) return text.videoErrorPlayback;
  if (code === 100) return text.videoErrorNotFound;
  if (code === 101 || code === 150 || code === 153) return text.videoErrorEmbedBlocked;
  return `${text.videoErrorGeneric} (${code})`;
}

function useDemoSession({
  sessionId,
  isDemoMode,
  expiresAtFromUrl,
}: {
  sessionId?: string;
  isDemoMode: boolean;
  expiresAtFromUrl: string | null;
}) {
  const [demoInfo, setDemoInfo] = useState<DemoSessionInfo | null>(null);
  const [demoSecondsLeft, setDemoSecondsLeft] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isDemoMode || !sessionId) {
      setDemoInfo(null);
      setDemoSecondsLeft(0);
      return;
    }

    const normalizedExpiresAt = expiresAtFromUrl?.trim() || null;
    const raw = sessionStorage.getItem('tactik:demo-session');
    let info: DemoSessionInfo | null = null;

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<DemoSessionInfo>;
        if (
          parsed.sessionId === sessionId &&
          typeof parsed.expiresAt === 'string' &&
          typeof parsed.guestId === 'string'
        ) {
          info = {
            sessionId: parsed.sessionId,
            expiresAt: parsed.expiresAt,
            guestId: parsed.guestId,
          };
        }
      } catch {}
    }

    if (!info) {
      info = {
        sessionId,
        expiresAt: normalizedExpiresAt ?? new Date(Date.now() + DEMO_FALLBACK_DURATION_MS).toISOString(),
        guestId: createDemoGuestId(),
      };
    }

    if (normalizedExpiresAt && info.expiresAt !== normalizedExpiresAt) {
      info = {
        ...info,
        expiresAt: normalizedExpiresAt,
      };
    }

    sessionStorage.setItem('tactik:demo-session', JSON.stringify(info));
    setDemoInfo(info);
    setDemoSecondsLeft(getDemoSecondsLeft(info.expiresAt));
  }, [expiresAtFromUrl, isDemoMode, sessionId]);

  useEffect(() => {
    if (!isDemoMode || !demoInfo) return;

    const syncFromAbsoluteTime = () => {
      const nextSecondsLeft = getDemoSecondsLeft(demoInfo.expiresAt);
      setDemoSecondsLeft(nextSecondsLeft);

      if (nextSecondsLeft <= 0) {
        sessionStorage.removeItem('tactik:demo-session');
        router.push('/');
      }
    };

    syncFromAbsoluteTime();

    const timer = setInterval(syncFromAbsoluteTime, 1000);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        syncFromAbsoluteTime();
      }
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', syncFromAbsoluteTime);

    return () => {
      clearInterval(timer);
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', syncFromAbsoluteTime);
    };
  }, [demoInfo, isDemoMode, router]);

  return { demoInfo, demoSecondsLeft };
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { user, checkAuth, isLoading: authLoading } = useAuthStore();
  const { language } = useUiStore();

  useInactivityLogout();

  const sessionId = params?.id;
  const isDisplayMode = searchParams.get('display') === '1';
  const isDemoMode = searchParams.get('demo') === '1';
  const demoExpiresAtFromUrl = searchParams.get('expiresAt');
  const demoRoomFromUrl = searchParams.get('room');
  const { demoInfo, demoSecondsLeft } = useDemoSession({
    sessionId,
    isDemoMode,
    expiresAtFromUrl: demoExpiresAtFromUrl,
  });
  const demoGuestId = demoInfo?.guestId ?? null;
  const socketUrl = useMemo(() => resolveBackendBaseUrl(), []);

  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [drawings, setDrawings] = useState<SessionDrawing[]>([]);
  const [remoteDrafts, setRemoteDrafts] = useState<Record<string, SessionDrawing>>({});
  const [redoStack, setRedoStack] = useState<SessionDrawing[]>([]);

  const [activeTool, setActiveTool] = useState<DrawTool>('freehand');
  const [lineThickness, setLineThickness] = useState(4);
  const [isMobileThicknessOpen, setIsMobileThicknessOpen] = useState(false);
  const [isMobileShapeMenuOpen, setIsMobileShapeMenuOpen] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<SessionDrawing | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isYoutubeClosePassThrough, setIsYoutubeClosePassThrough] = useState(false);
  const [isYoutubeClosePassThroughArmed, setIsYoutubeClosePassThroughArmed] = useState(true);
  const [youtubeHost, setYoutubeHost] = useState<'https://www.youtube-nocookie.com' | 'https://www.youtube.com'>('https://www.youtube-nocookie.com');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [qualityPreference, setQualityPreference] = useState<string>('max');
  const [isCanvasEnabled, setIsCanvasEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [isTouchLayout, setIsTouchLayout] = useState(false);
  const [isCompactTouchLayout, setIsCompactTouchLayout] = useState(false);
  const [isTouchLandscape, setIsTouchLandscape] = useState(false);
  const [isImmersiveControlsVisible, setIsImmersiveControlsVisible] = useState(true);
  const [isTopTouchBarCollapsed, setIsTopTouchBarCollapsed] = useState(false);
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [boardMode, setBoardMode] = useState<'move' | 'draw'>('move');
  const [isBoardNumberEditMode, setIsBoardNumberEditMode] = useState(false);
  const [isBoardGroupMove, setIsBoardGroupMove] = useState(false);
  const [boardSelectedPieceIds, setBoardSelectedPieceIds] = useState<string[]>([]);
  const [activeBoardPieceId, setActiveBoardPieceId] = useState<string | null>(null);
  const [boardPieceScale, setBoardPieceScale] = useState(1);
  const [boardPieces, setBoardPieces] = useState<BoardPiece[]>(() => createInitialBoardPieces());
  const [boardDrawings, setBoardDrawings] = useState<BoardPath[]>([]);
  const [boardDraft, setBoardDraft] = useState<BoardPath | null>(null);
  const [boardStateDirty, setBoardStateDirty] = useState(false);
  const [boardLabelsDirty, setBoardLabelsDirty] = useState(false);
  const [timelineMarkers, setTimelineMarkers] = useState<TimelineMarker[]>([]);
  const [timelineMenuState, setTimelineMenuState] = useState<TimelineMenuState | null>(null);
  const [isTimelineEditorOpen, setIsTimelineEditorOpen] = useState(false);
  const [isTimelineMarkersReady, setIsTimelineMarkersReady] = useState(false);
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
  const [activeParticipantColorUserId, setActiveParticipantColorUserId] = useState<string | null>(null);
  const [boardScrollIndicator, setBoardScrollIndicator] = useState({
    visible: false,
    top: 0,
    height: 0,
  });
  const [sessionDemoSecondsLeft, setSessionDemoSecondsLeft] = useState(0);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const boardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardOverlayScrollRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const playerRef = useRef<any>(null);
  const currentDraftRef = useRef<SessionDrawing | null>(null);
  const boardDragRef = useRef<{ pieceId: string; pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const boardGroupDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    anchorPieceId: string;
    selectedIds: string[];
    pieces: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  const boardDraftRef = useRef<BoardPath | null>(null);
  const boardDrawPointerIdRef = useRef<number | null>(null);
  const lastBoardSessionIdRef = useRef<string | null>(null);
  const boardCanvasDprRef = useRef(1);
  const canvasDprRef = useRef(1);
  const youtubeClosePassThroughTimerRef = useRef<number | null>(null);
  const youtubeReadyTimeoutRef = useRef<number | null>(null);
  const circleStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastDrawEmitAtRef = useRef(0);
  const suppressVideoEmitRef = useRef(false);
  const youtubeHostFallbackTriedRef = useRef(false);
  const pendingVideoSyncRef = useRef<VideoSyncState | null>(null);
  const suppressBoardEmitRef = useRef(false);
  const boardSyncTimerRef = useRef<number | null>(null);
  const lastBoardEmitAtRef = useRef(0);
  const boardVisibilityLockRef = useRef<{ value: boolean; ts: number } | null>(null);
  const timelineHoldTimerRef = useRef<number | null>(null);
  const timelineHoldPointerRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const suppressTimelineMarkerClickRef = useRef(false);
  const isImmersiveMode = isFullscreen || isPseudoFullscreen;
  const showImmersiveControls = !isTouchLayout || isImmersiveControlsVisible;
  const showTopActionBar = !isTouchLayout || !isTopTouchBarCollapsed;
  const text = SESSION_TEXT[language] || SESSION_TEXT.ru;
  const demoExpiresAtEffective = useMemo(() => {
    const sessionExpiresAt = session?.isDemo ? session.demoExpiresAt ?? null : null;
    return demoInfo?.expiresAt || sessionExpiresAt || null;
  }, [demoInfo?.expiresAt, session?.demoExpiresAt, session?.isDemo]);
  const demoTimerLabel = useMemo(
    () => formatSecondsToClock(sessionDemoSecondsLeft),
    [sessionDemoSecondsLeft]
  );
  const showSessionDemoTimer = sessionDemoSecondsLeft > 0 && Boolean(demoExpiresAtEffective);
  const youtubeThumbnailUrl = useMemo(
    () => (session?.youtubeVideoId ? `https://i.ytimg.com/vi/${session.youtubeVideoId}/hqdefault.jpg` : null),
    [session?.youtubeVideoId]
  );
  const showYoutubeThumbnailOverlay = Boolean(
    youtubeThumbnailUrl && !videoError && !isPlaying && currentTime <= 0.5
  );

  const toolLabels: Record<DrawTool, string> = useMemo(
    () => ({
      freehand: text.toolFreehand,
      arrow: text.toolArrow,
      circle: text.toolCircle,
      line: text.toolLine,
      text: text.toolText,
    }),
    [text]
  );

  const userIdForSocket = useMemo(() => {
    if (isDemoMode && demoGuestId) return demoGuestId;
    if (user?.id) return user.id;
    return `display-${sessionId || 'unknown'}`;
  }, [isDemoMode, demoGuestId, user?.id, sessionId]);

  const canDraw = useMemo(
    () => !isDisplayMode && (!!user?.id || (isDemoMode && !!demoGuestId)) && isCanvasEnabled,
    [isCanvasEnabled, isDisplayMode, user?.id, isDemoMode, demoGuestId]
  );
  const canUndo = canDraw && drawings.some((item) => item.userId === userIdForSocket);
  const canRedo = canDraw && redoStack.length > 0;
  const activeShapeTool = useMemo(
    () => (MOBILE_SHAPE_TOOL_SET.has(activeTool) ? activeTool : 'arrow'),
    [activeTool]
  );
  const isShapeToolActive = useMemo(() => MOBILE_SHAPE_TOOL_SET.has(activeTool), [activeTool]);
  const qualityOptions = useMemo(
    () => [
      { value: 'max', label: text.qualityMax },
      { value: 'auto', label: text.qualityAuto },
      ...availableQualities.map((level) => ({
        value: level,
        label: QUALITY_LABELS[level] || level,
      })),
    ],
    [availableQualities, text.qualityAuto, text.qualityMax]
  );
  const safeDuration = Number.isFinite(duration) ? Math.max(duration, 0) : 0;
  const clampedCurrentTime = safeDuration > 0 ? clamp(currentTime, 0, safeDuration) : 0;
  const playbackProgress = safeDuration > 0 ? (clampedCurrentTime / safeDuration) * 100 : 0;
  const currentTimeLabel = formatSecondsToClock(clampedCurrentTime);
  const durationLabel = formatSecondsToClock(safeDuration);
  const timelineStorageKey = useMemo(
    () => (sessionId ? `tactik:timeline-markers:${sessionId}` : null),
    [sessionId]
  );
  const timelineMarkerTypeLabels = useMemo(
    () => ({
      goal: text.timelineGoal,
      dismissal: text.timelineDismissal,
      substitution: text.timelineSubstitution,
      foul: text.timelineFoul,
      freeKick: text.timelineFreeKick,
    }),
    [text.timelineDismissal, text.timelineFoul, text.timelineFreeKick, text.timelineGoal, text.timelineSubstitution]
  );
  const youtubePlayerOpts = useMemo(() => {
    const playerVars: Record<string, string | number> = {
      controls: 0,
      rel: 0,
      modestbranding: 1,
      iv_load_policy: 3,
      playsinline: 1,
      disablekb: 1,
      fs: 0,
      enablejsapi: 1,
    };

    if (typeof window !== 'undefined') {
      playerVars.origin = window.location.origin;
    }

    return {
      width: '100%',
      height: '100%',
      host: youtubeHost,
      playerVars,
    };
  }, [youtubeHost]);

  useEffect(() => {
    if (typeof window === 'undefined' || !timelineStorageKey) {
      setTimelineMarkers([]);
      setIsTimelineMarkersReady(false);
      return;
    }

    setIsTimelineMarkersReady(false);
    try {
      const raw = window.localStorage.getItem(timelineStorageKey);
      setTimelineMarkers(raw ? normalizeTimelineMarkers(JSON.parse(raw)) : []);
    } catch {
      setTimelineMarkers([]);
    }
    setIsTimelineMarkersReady(true);
  }, [timelineStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !timelineStorageKey || !isTimelineMarkersReady) return;
    window.localStorage.setItem(timelineStorageKey, JSON.stringify(timelineMarkers));
  }, [isTimelineMarkersReady, timelineMarkers, timelineStorageKey]);

  useEffect(() => {
    const expiresAtFromSession = session?.isDemo ? session.demoExpiresAt ?? null : null;
    const expiresAt = demoInfo?.expiresAt || expiresAtFromSession;
    if (!expiresAt) return;

    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return;

    setDemoAuthMarker({ expiresAt });
  }, [demoInfo?.expiresAt, session?.demoExpiresAt, session?.isDemo]);

  useEffect(() => {
    if (!demoExpiresAtEffective) {
      setSessionDemoSecondsLeft(0);
      return;
    }

    if (isDemoMode && demoSecondsLeft > 0) {
      setSessionDemoSecondsLeft(demoSecondsLeft);
      return;
    }

    const syncValue = () => {
      setSessionDemoSecondsLeft(getDemoSecondsLeft(demoExpiresAtEffective));
    };

    syncValue();
    const timer = window.setInterval(syncValue, 1000);
    return () => window.clearInterval(timer);
  }, [demoExpiresAtEffective, demoSecondsLeft, isDemoMode]);

  useEffect(() => {
    setVideoError(null);
    setIsPlayerReady(false);
    setIsPlaying(false);
    setDuration(0);
    playerRef.current = null;
    setIsYoutubeClosePassThrough(false);
    setIsYoutubeClosePassThroughArmed(true);
    if (youtubeClosePassThroughTimerRef.current) {
      window.clearTimeout(youtubeClosePassThroughTimerRef.current);
      youtubeClosePassThroughTimerRef.current = null;
    }
    if (youtubeReadyTimeoutRef.current) {
      window.clearTimeout(youtubeReadyTimeoutRef.current);
      youtubeReadyTimeoutRef.current = null;
    }
    if (canvasRef.current) {
      canvasRef.current.style.pointerEvents = '';
    }
    setYoutubeHost('https://www.youtube-nocookie.com');
    youtubeHostFallbackTriedRef.current = false;
  }, [session?.youtubeVideoId]);

  useEffect(() => {
    return () => {
      if (youtubeClosePassThroughTimerRef.current) {
        window.clearTimeout(youtubeClosePassThroughTimerRef.current);
      }
      if (youtubeReadyTimeoutRef.current) {
        window.clearTimeout(youtubeReadyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!session?.youtubeVideoId || isPlayerReady) {
      if (youtubeReadyTimeoutRef.current) {
        window.clearTimeout(youtubeReadyTimeoutRef.current);
        youtubeReadyTimeoutRef.current = null;
      }
      return;
    }

    if (youtubeReadyTimeoutRef.current) {
      window.clearTimeout(youtubeReadyTimeoutRef.current);
    }

    youtubeReadyTimeoutRef.current = window.setTimeout(() => {
      if (!youtubeHostFallbackTriedRef.current && youtubeHost !== 'https://www.youtube.com') {
        youtubeHostFallbackTriedRef.current = true;
        setIsPlayerReady(false);
        setVideoError(null);
        playerRef.current = null;
        setYoutubeHost('https://www.youtube.com');
        return;
      }

      setVideoError(text.videoErrorGeneric);
    }, 8000);

    return () => {
      if (youtubeReadyTimeoutRef.current) {
        window.clearTimeout(youtubeReadyTimeoutRef.current);
        youtubeReadyTimeoutRef.current = null;
      }
    };
  }, [isPlayerReady, session?.youtubeVideoId, text.videoErrorGeneric, youtubeHost]);

  const handleToolSelect = useCallback(
    (tool: DrawTool) => {
      setActiveTool(tool);

      if (isCompactTouchLayout) {
        if (tool !== 'freehand') setIsMobileThicknessOpen(false);
        if (!MOBILE_SHAPE_TOOL_SET.has(tool)) setIsMobileShapeMenuOpen(false);
      }
    },
    [isCompactTouchLayout]
  );

  const handleMobilePencilSelect = useCallback(() => {
    setIsMobileShapeMenuOpen(false);
    setActiveTool('freehand');
    setIsMobileThicknessOpen((prev) => (activeTool === 'freehand' ? !prev : true));
  }, [activeTool, isTouchLayout]);

  const handleMobileShapeMenuToggle = useCallback(() => {
    setIsMobileThicknessOpen(false);
    setIsMobileShapeMenuOpen((prev) => !prev);
  }, []);

  const handleMobileShapeSelect = useCallback((tool: DrawTool) => {
    if (!MOBILE_SHAPE_TOOL_SET.has(tool)) return;
    setActiveTool(tool);
    setIsMobileShapeMenuOpen(false);
    setIsMobileThicknessOpen(false);
  }, []);

  const handleThicknessSelect = useCallback(
    (value: number) => {
      setLineThickness(value);
      if (isCompactTouchLayout) {
        setIsMobileThicknessOpen(false);
      }
    },
    [isCompactTouchLayout]
  );

  const getRoleLabel = useCallback(
    (role: SessionParticipant['role']) => {
      if (role === 'owner') return text.roleOwner;
      if (role === 'drawer') return text.roleDrawer;
      return text.roleViewer;
    },
    [text.roleDrawer, text.roleOwner, text.roleViewer]
  );

  const handleParticipantColorChange = useCallback(
    (participantUserId: string, nextColor: string) => {
      if (!sessionId) return;

      const normalizedColor = normalizeParticipantColor(nextColor, '');
      if (!normalizedColor) return;

      setParticipants((prev) =>
        dedupeParticipants(
          prev.map((participant) =>
            participant.userId === participantUserId
              ? {
                  ...participant,
                  color: normalizedColor,
                }
              : participant
          )
        )
      );
      setActiveParticipantColorUserId(null);
      socketRef.current?.emit('session:participant_color', {
        sessionId,
        userId: participantUserId,
        color: normalizedColor,
      });
    },
    [sessionId]
  );

  const canManageBoardLabels = useMemo(() => {
    if (isDisplayMode) return false;
    if (isDemoMode && Boolean(demoGuestId)) return true;
    return Boolean(user?.id) && (user?.id === session?.ownerId || user?.coachOwnerId === session?.ownerId);
  }, [isDisplayMode, isDemoMode, demoGuestId, session?.ownerId, user?.coachOwnerId, user?.id]);

  const boardTeamList = useMemo(() => {
    const sortById = (left: BoardPiece, right: BoardPiece) => {
      const leftValue = Number(left.id.split('-')[1] || 0);
      const rightValue = Number(right.id.split('-')[1] || 0);
      return leftValue - rightValue;
    };

    return {
      red: boardPieces.filter((piece) => piece.team === 'red').sort(sortById),
      yellow: boardPieces.filter((piece) => piece.team === 'yellow').sort(sortById),
    };
  }, [boardPieces]);

  const boardSelectedSet = useMemo(() => new Set(boardSelectedPieceIds), [boardSelectedPieceIds]);
  const myParticipant = useMemo(
    () => participants.find((participant) => participant.userId === userIdForSocket) || null,
    [participants, userIdForSocket]
  );

  const updateBoardScrollIndicator = useCallback(() => {
    const container = boardOverlayScrollRef.current;
    if (!container || !isTouchLayout || !isBoardOpen) {
      setBoardScrollIndicator((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }

    const scrollableHeight = container.scrollHeight - container.clientHeight;
    if (scrollableHeight <= 1) {
      setBoardScrollIndicator((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }

    const trackHeight = Math.max(container.clientHeight - 8, 1);
    const thumbHeight = Math.max(110, Math.round((container.clientHeight / container.scrollHeight) * trackHeight));
    const travel = Math.max(trackHeight - thumbHeight, 0);
    const top = Math.round((container.scrollTop / scrollableHeight) * travel);

    setBoardScrollIndicator((prev) => {
      if (prev.visible && prev.top === top && prev.height === thumbHeight) return prev;
      return { visible: true, top, height: thumbHeight };
    });
  }, [isBoardOpen, isTouchLayout]);

  const applyIncomingBoardState = useCallback((incomingState: BoardState | null | undefined) => {
    if (!incomingState) return;

    suppressBoardEmitRef.current = true;
    setBoardPieces((prev) => applyBoardState(prev, incomingState).pieces);
    setBoardDrawings(incomingState.drawings || []);
    setBoardDraft(null);
    boardDraftRef.current = null;
    boardDrawPointerIdRef.current = null;
    setBoardStateDirty(false);

    window.setTimeout(() => {
      suppressBoardEmitRef.current = false;
    }, 100);
  }, []);

  const applyBoardVisibility = useCallback((nextIsOpen: boolean, source: 'local' | 'remote') => {
    if (source === 'local') {
      boardVisibilityLockRef.current = { value: nextIsOpen, ts: Date.now() };
      setIsBoardOpen(nextIsOpen);
      return;
    }

    const lock = boardVisibilityLockRef.current;
    if (lock && Date.now() - lock.ts < BOARD_VISIBILITY_LOCK_MS && lock.value !== nextIsOpen) {
      return;
    }
    setIsBoardOpen(nextIsOpen);
  }, []);

  const handleOpenBoard = useCallback(() => {
    applyBoardVisibility(true, 'local');
    if (!sessionId) return;
    socketRef.current?.emit('board:visibility', { sessionId, isOpen: true });
  }, [applyBoardVisibility, sessionId]);

  const persistBoardLabels = useCallback(
    async (pieces: BoardPiece[]) => {
      if (!session?.id || !canManageBoardLabels) return;
      if (isDemoMode) {
        setBoardLabelsDirty(false);
        return;
      }

      const payload = toBoardPieceLabels(pieces);
      try {
        const response = await sessionsApi.updateBoardLabels(session.id, payload);
        if (response.success) {
          setBoardLabelsDirty(false);
        }
      } catch (saveError) {
        console.error('Failed to save board labels:', saveError);
      }
    },
    [canManageBoardLabels, isDemoMode, session?.id]
  );

  const persistBoardState = useCallback(
    async (pieces: BoardPiece[], drawings: BoardPath[]) => {
      if (!session?.id || !canManageBoardLabels) return;
      if (isDemoMode) {
        setBoardStateDirty(false);
        return;
      }

      const payload = toBoardState(pieces, drawings);
      try {
        const response = await sessionsApi.updateBoardState(session.id, payload);
        if (response.success) {
          setBoardStateDirty(false);
        }
      } catch (saveError) {
        console.error('Failed to save board state:', saveError);
      }
    },
    [canManageBoardLabels, isDemoMode, session?.id]
  );

  const handleCloseBoard = useCallback(async () => {
    if (boardStateDirty && canManageBoardLabels) {
      await persistBoardState(boardPieces, boardDrawings);
    }
    if (boardLabelsDirty && canManageBoardLabels) {
      await persistBoardLabels(boardPieces);
    }
    applyBoardVisibility(false, 'local');
    if (sessionId) {
      socketRef.current?.emit('board:visibility', { sessionId, isOpen: false });
    }
  }, [
    applyBoardVisibility,
    boardDrawings,
    boardLabelsDirty,
    boardPieces,
    boardStateDirty,
    canManageBoardLabels,
    sessionId,
    persistBoardLabels,
    persistBoardState,
  ]);

  const handleBoardLabelInputChange = useCallback((pieceId: string, value: string) => {
    const normalized = value.trim().slice(0, 3);
    setBoardPieces((prev) => {
      const next = prev.map((item) => (item.id === pieceId ? { ...item, label: normalized } : item));
      if (sessionId) {
        socketRef.current?.emit('board:labels', {
          sessionId,
          boardPieceLabels: toBoardPieceLabels(next),
        });
      }
      return next;
    });
    setBoardLabelsDirty(true);
  }, [sessionId]);

  const handleToggleBoardNumberEditMode = useCallback(async () => {
    if (boardMode !== 'move' || !canManageBoardLabels) return;

    if (isBoardNumberEditMode) {
      setIsBoardNumberEditMode(false);
      if (boardLabelsDirty) {
        await persistBoardLabels(boardPieces);
      }
      return;
    }

    setIsBoardGroupMove(false);
    setBoardSelectedPieceIds([]);
    setIsBoardNumberEditMode(true);
  }, [
    boardLabelsDirty,
    boardMode,
    boardPieces,
    canManageBoardLabels,
    isBoardNumberEditMode,
    persistBoardLabels,
  ]);

  const getBoardPieceClassName = useCallback((team: BoardTeam) => {
    if (team === 'red') {
      return 'bg-red-500 border-red-200 text-white shadow-[0_0_0_2px_rgba(255,255,255,0.2)]';
    }
    if (team === 'yellow') {
      return 'bg-yellow-300 border-yellow-100 text-black shadow-[0_0_0_2px_rgba(255,255,255,0.2)]';
    }
    return 'bg-cyan-300 border-cyan-100 text-black shadow-[0_0_0_2px_rgba(255,255,255,0.2)]';
  }, []);

  const myColor = useMemo(() => {
    if (myParticipant?.color) {
      return normalizeParticipantColor(myParticipant.color);
    }
    if (!sessionId) return DEFAULT_COLOR;
    return getColorForUser(userIdForSocket, session?.ownerId === user?.id);
  }, [myParticipant?.color, session?.ownerId, sessionId, user?.id, userIdForSocket]);

  const joinUrl = useMemo(() => {
    if (typeof window === 'undefined' || !session) return '';
    const url = new URL(`${window.location.origin}/session/${session.id}/join`);

    if (isDemoMode || session.isDemo) {
      url.searchParams.set('demo', '1');
      if (demoInfo?.expiresAt) {
        url.searchParams.set('expiresAt', demoInfo.expiresAt);
      }
      const roomCode = demoRoomFromUrl?.trim() || session.demoRoomCode || '';
      if (roomCode) {
        url.searchParams.set('room', roomCode);
      }
    }

    return url.toString();
  }, [demoInfo?.expiresAt, demoRoomFromUrl, isDemoMode, session]);

  const displayUrl = useMemo(() => {
    if (typeof window === 'undefined' || !session) return '';
    return `${window.location.origin}/display/${session.id}`;
  }, [session]);

  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setError(text.sessionIdMissing);
      setIsLoading(false);
      return;
    }

    if (!isDisplayMode && !isDemoMode && authLoading) {
      return;
    }

    if (!isDisplayMode && !isDemoMode && !user?.id) {
      setSession(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = isDisplayMode || isDemoMode
        ? await sessionsApi.getPublic(sessionId)
        : await sessionsApi.get(sessionId);
      if (!response.success || !response.data) {
        setSession(null);
        setError(response.error || text.sessionNotFound);
        return;
      }

      setSession(response.data);
    } catch (err: any) {
      setSession(null);
      setError(err?.response?.data?.error || text.failedToLoadSession);
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, isDisplayMode, isDemoMode, sessionId, text.failedToLoadSession, text.sessionIdMissing, text.sessionNotFound, user?.id]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const dpr = window.devicePixelRatio || 1;
    canvasDprRef.current = dpr;
    const { width, height } = wrapper.getBoundingClientRect();

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${Math.floor(width)}px`;
    canvas.style.height = `${Math.floor(height)}px`;
  }, []);

  const getBoardPointFromClient = useCallback((clientX: number, clientY: number) => {
    const area = boardAreaRef.current;
    if (!area) return null;

    const rect = area.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const resizeBoardCanvas = useCallback(() => {
    const canvas = boardCanvasRef.current;
    const area = boardAreaRef.current;
    if (!canvas || !area) return;

    const dpr = window.devicePixelRatio || 1;
    boardCanvasDprRef.current = dpr;
    const rect = area.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${Math.floor(rect.width)}px`;
    canvas.style.height = `${Math.floor(rect.height)}px`;

    const nextScale = clamp(rect.width / 1120, 0.72, 1);
    setBoardPieceScale((prev) => (Math.abs(prev - nextScale) < 0.01 ? prev : nextScale));
  }, []);

  const redrawBoardCanvas = useCallback(() => {
    const canvas = boardCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = boardCanvasDprRef.current || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.lineWidth = 4 * dpr;

    const drawPath = (path: Array<{ x: number; y: number }>) => {
      if (path.length < 2) return;
      ctx.beginPath();
      path.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    boardDrawings.forEach(drawPath);
    if (boardDraft) drawPath(boardDraft);
  }, [boardDraft, boardDrawings]);

  const handleBoardPiecePointerDown = useCallback(
    (pieceId: string, event: React.PointerEvent<HTMLButtonElement>) => {
      if (boardMode !== 'move') return;
      event.preventDefault();
      setActiveBoardPieceId(pieceId);

      const piece = boardPieces.find((item) => item.id === pieceId);
      if (!piece) return;

      if (isBoardNumberEditMode && piece.team !== 'ball') return;

      const point = getBoardPointFromClient(event.clientX, event.clientY);
      if (!point) return;

      if (isBoardGroupMove && piece.team !== 'ball') {
        if (!boardSelectedSet.has(pieceId)) {
          setBoardSelectedPieceIds((prev) => {
            if (prev.includes(pieceId)) return prev;
            return [...prev, pieceId];
          });
          return;
        }

        const selectedIds = boardSelectedPieceIds.includes(pieceId) ? boardSelectedPieceIds : [pieceId];
        boardGroupDragRef.current = {
          pointerId: event.pointerId,
          startX: point.x,
          startY: point.y,
          moved: false,
          anchorPieceId: pieceId,
          selectedIds,
          pieces: boardPieces
            .filter((item) => item.team !== 'ball' && selectedIds.includes(item.id))
            .map((item) => ({ id: item.id, x: item.x, y: item.y })),
        };

        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Ignore pointer capture failures.
        }
        return;
      }

      boardDragRef.current = {
        pieceId,
        pointerId: event.pointerId,
        offsetX: point.x - piece.x,
        offsetY: point.y - piece.y,
      };

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    },
    [
      boardMode,
      boardPieces,
      boardSelectedPieceIds,
      boardSelectedSet,
      getBoardPointFromClient,
      isBoardGroupMove,
      isBoardNumberEditMode,
    ]
  );

  const handleBoardPiecePointerMove = useCallback(
    (pieceId: string, event: React.PointerEvent<HTMLButtonElement>) => {
      const groupDrag = boardGroupDragRef.current;
      if (groupDrag && groupDrag.pointerId === event.pointerId) {
        const point = getBoardPointFromClient(event.clientX, event.clientY);
        if (!point) return;

        const deltaX = point.x - groupDrag.startX;
        const deltaY = point.y - groupDrag.startY;
        if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
          groupDrag.moved = true;
        }
        const startById = new Map(groupDrag.pieces.map((item) => [item.id, item]));

        setBoardPieces((prev) =>
          prev.map((item) => {
            if (item.team === 'ball' || !groupDrag.selectedIds.includes(item.id)) return item;
            const start = startById.get(item.id);
            if (!start) return item;
            return {
              ...item,
              x: clamp(start.x + deltaX, BOARD_PIECE_RADIUS, 1 - BOARD_PIECE_RADIUS),
              y: clamp(start.y + deltaY, BOARD_PIECE_RADIUS, 1 - BOARD_PIECE_RADIUS),
            };
          })
        );
        setBoardStateDirty(true);
        return;
      }

      const drag = boardDragRef.current;
      if (!drag || drag.pieceId !== pieceId || drag.pointerId !== event.pointerId) return;

      const point = getBoardPointFromClient(event.clientX, event.clientY);
      if (!point) return;

      const nextX = clamp(point.x - drag.offsetX, BOARD_PIECE_RADIUS, 1 - BOARD_PIECE_RADIUS);
      const nextY = clamp(point.y - drag.offsetY, BOARD_PIECE_RADIUS, 1 - BOARD_PIECE_RADIUS);
      setBoardPieces((prev) => prev.map((item) => (item.id === pieceId ? { ...item, x: nextX, y: nextY } : item)));
      setBoardStateDirty(true);
    },
    [getBoardPointFromClient]
  );

  const handleBoardPiecePointerUp = useCallback((pieceId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    const groupDrag = boardGroupDragRef.current;
    if (groupDrag && groupDrag.pointerId === event.pointerId) {
      boardGroupDragRef.current = null;
      if (!groupDrag.moved && groupDrag.anchorPieceId === pieceId) {
        setBoardSelectedPieceIds((prev) => prev.filter((id) => id !== pieceId));
      }
      setBoardStateDirty(true);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
      return;
    }

    const drag = boardDragRef.current;
    if (!drag || drag.pieceId !== pieceId || drag.pointerId !== event.pointerId) return;

    boardDragRef.current = null;
    setBoardStateDirty(true);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture failures.
    }
  }, []);

  const finalizeBoardDraft = useCallback(() => {
    const draft = boardDraftRef.current;
    boardDraftRef.current = null;
    boardDrawPointerIdRef.current = null;

    if (!draft || draft.length < 2) {
      setBoardDraft(null);
      return;
    }

    setBoardDrawings((prev) => [...prev, draft]);
    setBoardDraft(null);
    setBoardStateDirty(true);
  }, []);

  const handleBoardCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (boardMode !== 'draw') return;
      event.preventDefault();
      setActiveBoardPieceId(null);

      const point = getBoardPointFromClient(event.clientX, event.clientY);
      if (!point) return;

      const initialPath = [point];
      boardDraftRef.current = initialPath;
      boardDrawPointerIdRef.current = event.pointerId;
      setBoardDraft(initialPath);

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    },
    [boardMode, getBoardPointFromClient]
  );

  const handleBoardCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (boardMode !== 'draw') return;
      if (boardDrawPointerIdRef.current !== event.pointerId) return;
      const draft = boardDraftRef.current;
      if (!draft) return;
      event.preventDefault();

      const point = getBoardPointFromClient(event.clientX, event.clientY);
      if (!point) return;

      const lastPoint = draft[draft.length - 1];
      if (lastPoint) {
        const dx = point.x - lastPoint.x;
        const dy = point.y - lastPoint.y;
        if (dx * dx + dy * dy < BOARD_DRAW_POINT_STEP * BOARD_DRAW_POINT_STEP) {
          return;
        }
      }

      const updated = [...draft, point];
      boardDraftRef.current = updated;
      setBoardDraft(updated);
    },
    [boardMode, getBoardPointFromClient]
  );

  const handleBoardCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (boardDrawPointerIdRef.current !== event.pointerId) return;
    finalizeBoardDraft();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture failures.
    }
  }, [finalizeBoardDraft]);

  const drawArrowHead = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    const headLength = 12 * canvasDprRef.current;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const renderDrawing = useCallback(
    (ctx: CanvasRenderingContext2D, drawing: SessionDrawing, canvasWidth: number, canvasHeight: number) => {
      const color = drawing.color || DEFAULT_COLOR;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const videoFrame = getVideoFrame(canvasWidth, canvasHeight);
      const frame: FrameBox =
        drawing.coordinateSpace === 'canvas'
          ? { left: 0, top: 0, width: canvasWidth, height: canvasHeight }
          : videoFrame;
      const toPixelX = (value: number) => frame.left + value * frame.width;
      const toPixelY = (value: number) => frame.top + value * frame.height;

      if (drawing.tool === 'freehand') {
        const data = drawing.data as FreehandData;
        const points = data.points || [];
        if (points.length === 0) return;

        ctx.lineWidth = (data.thickness || lineThickness) * canvasDprRef.current;
        ctx.beginPath();
        points.forEach((point, idx) => {
          const x = toPixelX(point.x);
          const y = toPixelY(point.y);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        return;
      }

      if (drawing.tool === 'line') {
        const data = drawing.data as LineData;
        ctx.lineWidth = (data.thickness || lineThickness) * canvasDprRef.current;
        const x1 = toPixelX(data.startX);
        const y1 = toPixelY(data.startY);
        const x2 = toPixelX(data.endX);
        const y2 = toPixelY(data.endY);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return;
      }

      if (drawing.tool === 'arrow') {
        const data = drawing.data as ArrowData;
        ctx.lineWidth = (data.thickness || lineThickness) * canvasDprRef.current;
        const x1 = toPixelX(data.startX);
        const y1 = toPixelY(data.startY);
        const x2 = toPixelX(data.endX);
        const y2 = toPixelY(data.endY);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        drawArrowHead(ctx, x1, y1, x2, y2);
        return;
      }

      if (drawing.tool === 'circle') {
        const data = drawing.data as CircleData;
        const radius = data.radius * Math.min(frame.width, frame.height);
        const cx = toPixelX(data.centerX);
        const cy = toPixelY(data.centerY);
        ctx.lineWidth = (data.thickness || lineThickness) * canvasDprRef.current;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        if (data.filled) ctx.fill();
        else ctx.stroke();
        return;
      }

      if (drawing.tool === 'text') {
        const data = drawing.data as TextData;
        const x = toPixelX(data.x);
        const y = toPixelY(data.y);
        ctx.font = `${Math.max(12, data.fontSize || 22) * canvasDprRef.current}px Arial`;
        ctx.fillText(data.text, x, y);
      }
    },
    [lineThickness]
  );

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const frame = getVideoFrame(canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, frame.top, frame.width, frame.height);
    ctx.clip();

    [...drawings, ...Object.values(remoteDrafts)].forEach((drawing) => {
      renderDrawing(ctx, drawing, canvas.width, canvas.height);
    });

    if (currentDraft) {
      renderDrawing(ctx, currentDraft, canvas.width, canvas.height);
    }
    ctx.restore();
  }, [currentDraft, drawings, remoteDrafts, renderDrawing]);

  const getPointerPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>, requireInsideVideo: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const frame = getVideoFrame(rect.width, rect.height);
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    const isOutsideFrame =
      localX < frame.left ||
      localX > frame.left + frame.width ||
      localY < frame.top ||
      localY > frame.top + frame.height;

    if (requireInsideVideo && isOutsideFrame) return null;

    const x = clamp((localX - frame.left) / frame.width, 0, 1);
    const y = clamp((localY - frame.top) / frame.height, 0, 1);
    return { x, y };
  }, []);

  const emitVideo = useCallback(
    (eventName: 'video:play' | 'video:pause' | 'video:seek', timeValue: number) => {
      if (suppressVideoEmitRef.current || !sessionId) return;
      socketRef.current?.emit(eventName, { sessionId, time: timeValue });
    },
    [sessionId]
  );

  const syncQualityLevels = useCallback((playerInput?: any) => {
    const player = playerInput || playerRef.current;
    if (!player?.getAvailableQualityLevels) return [];

    const normalized = normalizeQualityLevels(player.getAvailableQualityLevels());
    setAvailableQualities((prev) => (prev.join('|') === normalized.join('|') ? prev : normalized));
    return normalized;
  }, []);

  const applyQualityPreference = useCallback(
    (preference: string, playerInput?: any) => {
      const player = playerInput || playerRef.current;
      if (!player?.setPlaybackQuality) return;

      const levels = syncQualityLevels(player);
      if (preference === 'auto') {
        player.setPlaybackQuality('default');
        return;
      }

      if (preference === 'max') {
        const top = getTopQualityLevel(levels);
        if (top) player.setPlaybackQuality(top);
        return;
      }

      player.setPlaybackQuality(preference);
    },
    [syncQualityLevels]
  );

  const handleQualityChange = useCallback(
    (nextPreference: string) => {
      setQualityPreference(nextPreference);
      applyQualityPreference(nextPreference);
    },
    [applyQualityPreference]
  );

  const applyVideoSync = useCallback((state: VideoSyncState) => {
    const player = playerRef.current;
    if (!player) {
      pendingVideoSyncRef.current = state;
      setCurrentTime(state.currentTime || 0);
      setPlaybackRate(state.playbackRate || 1);
      setIsPlaying(Boolean(state.isPlaying));
      return;
    }

    pendingVideoSyncRef.current = null;

    suppressVideoEmitRef.current = true;

    try {
      player.seekTo(state.currentTime, true);
      player.setPlaybackRate(state.playbackRate || 1);

      if (state.isPlaying) player.playVideo();
      else player.pauseVideo();

      applyQualityPreference(qualityPreference, player);

      setCurrentTime(state.currentTime || 0);
      setPlaybackRate(state.playbackRate || 1);
      setIsPlaying(Boolean(state.isPlaying));
    } finally {
      window.setTimeout(() => {
        suppressVideoEmitRef.current = false;
      }, 120);
    }
  }, [applyQualityPreference, qualityPreference]);

  const handlePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player || !isPlayerReady) return;

    if (isPlaying) {
      player.pauseVideo();
      const t = Number(player.getCurrentTime?.() || currentTime || 0);
      setIsPlaying(false);
      setCurrentTime(t);
      emitVideo('video:pause', t);
      return;
    }

    player.playVideo();
    applyQualityPreference(qualityPreference, player);
    const t = Number(player.getCurrentTime?.() || currentTime || 0);
    setIsPlaying(true);
    setCurrentTime(t);
    emitVideo('video:play', t);
  }, [applyQualityPreference, currentTime, emitVideo, isPlayerReady, isPlaying, qualityPreference]);

  const handleSeek = useCallback(
    (targetTime: number, broadcast: boolean) => {
      const player = playerRef.current;
      if (!player) return;

      const nextTime = clamp(targetTime, 0, Math.max(duration, 0));
      player.seekTo(nextTime, true);
      setCurrentTime(nextTime);
      if (broadcast) emitVideo('video:seek', nextTime);
    },
    [duration, emitVideo]
  );

  const cancelTimelineHold = useCallback(() => {
    if (timelineHoldTimerRef.current) {
      window.clearTimeout(timelineHoldTimerRef.current);
      timelineHoldTimerRef.current = null;
    }
    timelineHoldPointerRef.current = null;
  }, []);

  const openTimelineMenu = useCallback((time: number, leftPercent: number, markerId: string | null) => {
    setTimelineMenuState({
      time,
      leftPercent: clamp(leftPercent, 10, 90),
      markerId,
    });
  }, []);

  const beginTimelineHold = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      options: { time: number; leftPercent: number; markerId: string | null; suppressClick?: boolean }
    ) => {
      if (safeDuration <= 0) return;

      cancelTimelineHold();
      timelineHoldPointerRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };

      timelineHoldTimerRef.current = window.setTimeout(() => {
        if (options.suppressClick) {
          suppressTimelineMarkerClickRef.current = true;
        }
        openTimelineMenu(options.time, options.leftPercent, options.markerId);
        timelineHoldTimerRef.current = null;
      }, TIMELINE_MARKER_HOLD_MS);
    },
    [cancelTimelineHold, openTimelineMenu, safeDuration]
  );

  const handleTimelineRailPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (safeDuration <= 0) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;

      const leftPercent = getTimelineAlignedPercent(event.clientX, rect);
      const markerTime = (leftPercent / 100) * safeDuration;
      beginTimelineHold(event, {
        time: markerTime,
        leftPercent,
        markerId: null,
      });
    },
    [beginTimelineHold, safeDuration]
  );

  const handleTimelineMarkerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, marker: TimelineMarker) => {
      event.stopPropagation();
      if (safeDuration <= 0) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      beginTimelineHold(event, {
        time: marker.time,
        leftPercent: safeDuration > 0 ? (marker.time / safeDuration) * 100 : 0,
        markerId: marker.id,
        suppressClick: true,
      });
    },
    [beginTimelineHold, safeDuration]
  );

  const handleTimelinePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const active = timelineHoldPointerRef.current;
      if (!active || active.pointerId !== event.pointerId) return;

      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 8) {
        cancelTimelineHold();
      }
    },
    [cancelTimelineHold]
  );

  const handleTimelinePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const active = timelineHoldPointerRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      cancelTimelineHold();
    },
    [cancelTimelineHold]
  );

  const handleTimelineMarkerClick = useCallback(
    (marker: TimelineMarker) => {
      if (suppressTimelineMarkerClickRef.current) {
        suppressTimelineMarkerClickRef.current = false;
        return;
      }
      handleSeek(marker.time, true);
      setTimelineMenuState(null);
    },
    [handleSeek]
  );

  const handleTimelineMenuSelect = useCallback(
    (type: TimelineMarkerType) => {
      if (!timelineMenuState) return;

      setTimelineMarkers((prev) => {
        const next = timelineMenuState.markerId
          ? prev.map((marker) =>
              marker.id === timelineMenuState.markerId
                ? {
                    ...marker,
                    type,
                    time: timelineMenuState.time,
                  }
                : marker
            )
          : [
              ...prev,
              {
                id: createId(),
                time: timelineMenuState.time,
                type,
              },
            ];

        return [...next].sort((left, right) => left.time - right.time);
      });

      setTimelineMenuState(null);
    },
    [timelineMenuState]
  );

  const handleTimelineMarkerDelete = useCallback((markerId: string) => {
    setTimelineMarkers((prev) => prev.filter((marker) => marker.id !== markerId));
    setTimelineMenuState((prev) => (prev?.markerId === markerId ? null : prev));
  }, []);

  const handleTimelineDeleteAll = useCallback(() => {
    setTimelineMarkers([]);
    setTimelineMenuState(null);
  }, []);

  useEffect(() => {
    return () => {
      cancelTimelineHold();
    };
  }, [cancelTimelineHold]);

  useEffect(() => {
    if (!timelineMenuState) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-timeline-menu="1"]')) return;
      setTimelineMenuState(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [timelineMenuState]);

  useEffect(() => {
    if (!activeParticipantColorUserId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-participant-color-picker="1"]')) return;
      setActiveParticipantColorUserId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [activeParticipantColorUserId]);

  useEffect(() => {
    if (!isQualityMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-quality-menu="1"]')) return;
      setIsQualityMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isQualityMenuOpen]);

  useEffect(() => {
    if (!activeParticipantColorUserId) return;
    if (!participants.some((participant) => participant.userId === activeParticipantColorUserId)) {
      setActiveParticipantColorUserId(null);
    }
  }, [activeParticipantColorUserId, participants]);

  useEffect(() => {
    if (!isTimelineEditorOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTimelineEditorOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTimelineEditorOpen]);

  const handlePlaybackRate = useCallback((rate: number) => {
    const player = playerRef.current;
    if (!player) return;

    player.setPlaybackRate(rate);
    setPlaybackRate(rate);
    // For now use seek event as sync trigger with current time.
    emitVideo('video:seek', Number(player.getCurrentTime?.() || currentTime || 0));
  }, [currentTime, emitVideo]);

  const handleMuteToggle = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (isMuted) {
      player.unMute();
      player.setVolume(volume);
      setIsMuted(false);
    } else {
      player.mute();
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    const player = playerRef.current;
    if (!player) return;
    setVolume(newVolume);
    player.setVolume(newVolume);
    if (newVolume === 0) {
      setIsMuted(true);
    } else if (isMuted) {
      player.unMute();
      setIsMuted(false);
    }
  }, [isMuted]);

  const handleVideoEnd = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    // Keep playback just before "ended" to avoid YouTube suggested-videos overlay.
    const d = Number(player.getDuration?.() || duration || 0);
    const safeTime = Math.max(d - 0.25, 0);

    suppressVideoEmitRef.current = true;
    try {
      player.seekTo(safeTime, true);
      player.pauseVideo();
      setCurrentTime(safeTime);
      setIsPlaying(false);
      emitVideo('video:pause', safeTime);
    } finally {
      window.setTimeout(() => {
        suppressVideoEmitRef.current = false;
      }, 120);
    }
  }, [duration, emitVideo]);

  const handlePlayerReady = useCallback(
    (event: YouTubeEvent) => {
      if (youtubeReadyTimeoutRef.current) {
        window.clearTimeout(youtubeReadyTimeoutRef.current);
        youtubeReadyTimeoutRef.current = null;
      }
      playerRef.current = event.target;
      setIsPlayerReady(true);
      setVideoError(null);
      setDuration(Number(event.target.getDuration?.() || 0));
      syncQualityLevels(event.target);
      applyQualityPreference(qualityPreference, event.target);
      if (pendingVideoSyncRef.current) {
        applyVideoSync(pendingVideoSyncRef.current);
      }
    },
    [applyQualityPreference, applyVideoSync, qualityPreference, syncQualityLevels]
  );

  const handlePlayerStateChange = useCallback((event: YouTubeEvent<number>) => {
    const state = Number(event?.data ?? -1);
    const player = playerRef.current;

    if (state === 1) {
      setIsPlaying(true);
      setVideoError(null);
      if (player) {
        const t = Number(player.getCurrentTime?.() || 0);
        if (!Number.isNaN(t)) setCurrentTime(t);
      }
      return;
    }

    if (state === 2 || state === 0 || state === 5 || state === -1) {
      setIsPlaying(false);
      if (player) {
        const t = Number(player.getCurrentTime?.() || 0);
        if (!Number.isNaN(t)) setCurrentTime(t);
      }
    }
  }, []);

  const handlePlayerError = useCallback((event: YouTubeEvent<number>) => {
    const code = Number(event?.data || 0);

    if (!youtubeHostFallbackTriedRef.current && youtubeHost !== 'https://www.youtube.com' && (code === 5 || code === 153)) {
      youtubeHostFallbackTriedRef.current = true;
      setIsPlayerReady(false);
      setVideoError(null);
      playerRef.current = null;
      setYoutubeHost('https://www.youtube.com');
      return;
    }

    setVideoError(getYoutubeErrorMessage(code, text));
    console.error('YouTube player error:', code);
  }, [text, youtubeHost]);

  const handleToggleFullscreen = useCallback(async () => {
    const doc = document as FullscreenCapableDocument;
    const target = wrapperRef.current as FullscreenCapableElement | null;
    if (!target) return;

    if (isPseudoFullscreen) {
      setIsPseudoFullscreen(false);
      return;
    }

    if (getFullscreenElement(doc)) {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
        return;
      }
      if (doc.webkitExitFullscreen) {
        await Promise.resolve(doc.webkitExitFullscreen());
        return;
      }
      if (doc.msExitFullscreen) {
        await Promise.resolve(doc.msExitFullscreen());
      }
      return;
    }

    if (target.requestFullscreen) {
      await target.requestFullscreen();
      return;
    }
    if (target.webkitRequestFullscreen) {
      await Promise.resolve(target.webkitRequestFullscreen());
      return;
    }
    if (target.msRequestFullscreen) {
      await Promise.resolve(target.msRequestFullscreen());
      return;
    }

    // iOS browsers can lack element fullscreen API; fallback to fixed "immersive" mode.
    setIsPseudoFullscreen(true);
  }, [isPseudoFullscreen]);

  const handleCanvasTouchNative = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    event.preventDefault();
    event.stopPropagation();
  }, [canDraw]);

  const finalizeCurrentDraft = useCallback(() => {
    const draft = currentDraftRef.current;
    if (!draft || !sessionId) return;

    const finalDrawing: SessionDrawing = {
      ...draft,
      isDraft: false,
      createdAt: new Date().toISOString(),
    };

    lastDrawEmitAtRef.current = 0;
    currentDraftRef.current = null;
    circleStartRef.current = null;
    setDrawings((prev) => [...prev, finalDrawing]);
    setRedoStack([]);
    setCurrentDraft(null);

    socketRef.current?.emit('draw:end', {
      sessionId,
      drawing: finalDrawing,
    });
  }, [sessionId]);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !sessionId) return;

    if (isYoutubeClosePassThroughArmed && isInYoutubeRelatedCloseZone(event, wrapperRef.current)) {
      const canvas = event.currentTarget;
      canvas.style.pointerEvents = 'none';
      setIsYoutubeClosePassThrough(true);

      if (youtubeClosePassThroughTimerRef.current) {
        window.clearTimeout(youtubeClosePassThroughTimerRef.current);
      }

      youtubeClosePassThroughTimerRef.current = window.setTimeout(() => {
        if (canvasRef.current) {
          canvasRef.current.style.pointerEvents = '';
        }
        setIsYoutubeClosePassThrough(false);
        setIsYoutubeClosePassThroughArmed(false);
        youtubeClosePassThroughTimerRef.current = null;
      }, YOUTUBE_RELATED_PASSTHROUGH_MS);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const point = getPointerPoint(event, true);
    if (!point) return;

    if (activeTool === 'text') {
      const value = window.prompt(text.enterLabel);
      if (!value?.trim()) return;

      const textDrawing: SessionDrawing = {
        id: createId(),
        sessionId,
        userId: userIdForSocket,
        videoTimestamp: currentTime,
        tool: 'text',
        color: myColor,
        coordinateSpace: 'video',
        createdAt: new Date().toISOString(),
        data: {
          x: point.x,
          y: point.y,
          text: value.trim(),
          fontSize: 22,
        } as TextData,
      };

      setDrawings((prev) => [...prev, textDrawing]);
      setRedoStack([]);
      currentDraftRef.current = null;
      socketRef.current?.emit('draw:end', { sessionId, drawing: textDrawing });
      return;
    }

    lastDrawEmitAtRef.current = 0;
    if (!isTouchLayout) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore if browser does not support pointer capture on this target.
      }
    }

    const base: SessionDrawing = {
      id: createId(),
      sessionId,
      userId: userIdForSocket,
      videoTimestamp: currentTime,
      tool: activeTool,
      color: myColor,
      coordinateSpace: 'video',
      createdAt: new Date().toISOString(),
      isDraft: true,
      data:
        activeTool === 'freehand'
          ? ({ points: [point], thickness: lineThickness } as FreehandData)
          : activeTool === 'circle'
            ? (circleStartRef.current = { x: point.x, y: point.y },
               { centerX: point.x, centerY: point.y, radius: 0, thickness: lineThickness } as CircleData)
            : ({
                startX: point.x,
                startY: point.y,
                endX: point.x,
                endY: point.y,
                thickness: lineThickness,
              } as ArrowData),
    };

    currentDraftRef.current = base;
    setCurrentDraft(base);
    socketRef.current?.emit('draw:start', { sessionId, drawing: base });
  }, [
    activeTool,
    canDraw,
    currentTime,
    getPointerPoint,
    isTouchLayout,
    isYoutubeClosePassThroughArmed,
    lineThickness,
    myColor,
    sessionId,
    text.enterLabel,
    userIdForSocket,
  ]);

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    const draft = currentDraftRef.current;
    if (!draft) return;
    event.preventDefault();
    event.stopPropagation();

    const point = getPointerPoint(event, false);
    if (!point) return;
    const updated = { ...draft };

    if (updated.tool === 'freehand') {
      const data = updated.data as FreehandData;
      updated.data = {
        ...data,
        points: [...data.points, point],
      };
    } else if (updated.tool === 'circle') {
      const data = updated.data as CircleData;
      const start = circleStartRef.current ?? { x: data.centerX, y: data.centerY };
      const centerX = (start.x + point.x) / 2;
      const centerY = (start.y + point.y) / 2;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      updated.data = {
        ...data,
        centerX,
        centerY,
        radius: Math.sqrt(dx * dx + dy * dy) / 2,
      };
    } else {
      const data = updated.data as ArrowData;
      updated.data = {
        ...data,
        endX: point.x,
        endY: point.y,
      };
    }

    currentDraftRef.current = updated;
    setCurrentDraft(updated);

    const now = Date.now();
    if (now - lastDrawEmitAtRef.current >= 33) {
      lastDrawEmitAtRef.current = now;
      socketRef.current?.emit('draw:update', {
        sessionId,
        drawing: { ...updated, isDraft: true },
      });
    }
  };

  const handleCanvasPointerUp = useCallback((event?: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = currentDraftRef.current;
    if (!draft || !sessionId) return;
    event?.preventDefault();
    event?.stopPropagation();
    if (event && !isTouchLayout) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if capture was not active.
      }
    }
    finalizeCurrentDraft();
  }, [finalizeCurrentDraft, isTouchLayout, sessionId]);

  const handleUndo = useCallback(() => {
    if (!sessionId) return;

    const lastOwn = [...drawings].reverse().find((item) => item.userId === userIdForSocket);
    if (!lastOwn) return;

    setDrawings((prev) => prev.filter((item) => item.id !== lastOwn.id));
    setRedoStack((prev) => [...prev, lastOwn]);
    socketRef.current?.emit('draw:undo', { sessionId, drawingId: lastOwn.id });
  }, [drawings, sessionId, userIdForSocket]);

  const handleRedo = useCallback(() => {
    if (!sessionId || redoStack.length === 0) return;

    const source = redoStack[redoStack.length - 1];
    const redoneDrawing: SessionDrawing = {
      ...source,
      id: createId(),
      userId: userIdForSocket,
      sessionId,
      isDraft: false,
      createdAt: new Date().toISOString(),
    };

    setRedoStack((prev) => prev.slice(0, -1));
    setDrawings((prev) => [...prev, redoneDrawing]);
    socketRef.current?.emit('draw:end', { sessionId, drawing: redoneDrawing });
  }, [redoStack, sessionId, userIdForSocket]);

  const handleClear = useCallback(() => {
    if (!sessionId) return;
    setDrawings([]);
    setRemoteDrafts({});
    setRedoStack([]);
    currentDraftRef.current = null;
    setCurrentDraft(null);
    socketRef.current?.emit('draw:clear', { sessionId });
  }, [sessionId]);

  const copyToClipboard = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  };

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session?.id || typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, session.id);
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    const isSessionChanged = lastBoardSessionIdRef.current !== session.id;
    lastBoardSessionIdRef.current = session.id;

    const piecesWithLabels = applyBoardPieceLabels(createInitialBoardPieces(), session.boardPieceLabels);
    const boardState = applyBoardState(piecesWithLabels, session.boardState);
    setBoardPieces(boardState.pieces);
    setBoardDrawings(boardState.drawings);
    setBoardDraft(null);
    setBoardStateDirty(false);
    setBoardLabelsDirty(false);
    if (isSessionChanged) {
      setIsBoardNumberEditMode(false);
      setIsBoardGroupMove(false);
      setBoardSelectedPieceIds([]);
    }
  }, [session?.boardPieceLabels, session?.boardState, session?.id]);

  useEffect(() => {
    if (!isBoardOpen || !canManageBoardLabels || !boardStateDirty) return;

    const timer = window.setTimeout(() => {
      void persistBoardState(boardPieces, boardDrawings);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [boardDrawings, boardPieces, boardStateDirty, canManageBoardLabels, isBoardOpen, persistBoardState]);

  useEffect(() => {
    if (!sessionId || !isBoardOpen) return;
    if (suppressBoardEmitRef.current) return;

    const emitBoardState = () => {
      socketRef.current?.emit('board:state', {
        sessionId,
        boardState: toBoardState(boardPieces, boardDrawings),
      });
      lastBoardEmitAtRef.current = Date.now();
      boardSyncTimerRef.current = null;
    };

    const elapsed = Date.now() - lastBoardEmitAtRef.current;
    if (elapsed >= BOARD_SYNC_INTERVAL_MS) {
      if (boardSyncTimerRef.current) {
        window.clearTimeout(boardSyncTimerRef.current);
        boardSyncTimerRef.current = null;
      }
      emitBoardState();
      return;
    }

    if (boardSyncTimerRef.current) {
      window.clearTimeout(boardSyncTimerRef.current);
    }
    boardSyncTimerRef.current = window.setTimeout(emitBoardState, BOARD_SYNC_INTERVAL_MS - elapsed);
  }, [boardDrawings, boardPieces, isBoardOpen, sessionId]);

  useEffect(() => {
    if (isBoardOpen) return;
    if (boardSyncTimerRef.current) {
      window.clearTimeout(boardSyncTimerRef.current);
      boardSyncTimerRef.current = null;
    }
  }, [isBoardOpen]);

  useEffect(() => {
    return () => {
      if (boardSyncTimerRef.current) {
        window.clearTimeout(boardSyncTimerRef.current);
        boardSyncTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || Boolean(target?.isContentEditable);
      if (isTyping) return;

      const key = event.key.toLowerCase();
      const withModifier = event.ctrlKey || event.metaKey;

      if (withModifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if (withModifier && key === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (!canDraw) return;

      if (key === 'b') setActiveTool('freehand');
      if (key === 'a') setActiveTool('arrow');
      if (key === 'c') setActiveTool('circle');
      if (key === 'l') setActiveTool('line');
      if (key === 't') setActiveTool('text');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canDraw, handleRedo, handleUndo]);

  useEffect(() => {
    resizeCanvas();
    redrawCanvas();
  }, [redrawCanvas, resizeCanvas]);

  useEffect(() => {
    if (!isBoardOpen) return;
    resizeBoardCanvas();
    redrawBoardCanvas();
  }, [isBoardOpen, redrawBoardCanvas, resizeBoardCanvas]);

  useEffect(() => {
    if (!isBoardOpen) return;
    const onResize = () => {
      resizeBoardCanvas();
      redrawBoardCanvas();
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isBoardOpen, redrawBoardCanvas, resizeBoardCanvas]);

  useEffect(() => {
    if (boardMode !== 'draw') {
      boardDraftRef.current = null;
      boardDrawPointerIdRef.current = null;
      setBoardDraft(null);
    }
    if (boardMode === 'draw') {
      setActiveBoardPieceId(null);
      setIsBoardNumberEditMode(false);
      setIsBoardGroupMove(false);
      setBoardSelectedPieceIds([]);
    }
  }, [boardMode]);

  useEffect(() => {
    if (!isBoardOpen || boardMode !== 'draw') return;

    const onPointerEnd = () => {
      if (!boardDraftRef.current) return;
      finalizeBoardDraft();
    };

    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);

    return () => {
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [boardMode, finalizeBoardDraft, isBoardOpen]);

  useEffect(() => {
    if (!currentDraft || !canDraw) return;

    const onPointerEnd = () => {
      finalizeCurrentDraft();
    };

    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);

    return () => {
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [canDraw, currentDraft, finalizeCurrentDraft]);

  useEffect(() => {
    const onResize = () => {
      resizeCanvas();
      redrawCanvas();
    };

    window.addEventListener('resize', onResize);

    const wrapper = wrapperRef.current;
    let observer: ResizeObserver | null = null;
    if (wrapper && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize);
      observer.observe(wrapper);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [redrawCanvas, resizeCanvas]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as FullscreenCapableDocument;
      const isNativeFullscreen = Boolean(getFullscreenElement(doc));
      setIsFullscreen(isNativeFullscreen);
      if (isNativeFullscreen) {
        setIsPseudoFullscreen(false);
      }
      resizeCanvas();
      redrawCanvas();
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
    document.addEventListener('MSFullscreenChange', onFullscreenChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
      document.removeEventListener('MSFullscreenChange', onFullscreenChange as EventListener);
    };
  }, [redrawCanvas, resizeCanvas]);

  useEffect(() => {
    if (!isPseudoFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPseudoFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isPseudoFullscreen]);

  useEffect(() => {
    if (!isBoardOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void handleCloseBoard();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [handleCloseBoard, isBoardOpen]);

  useEffect(() => {
    if (isBoardOpen) return;
    boardDragRef.current = null;
    boardGroupDragRef.current = null;
    boardDraftRef.current = null;
    boardDrawPointerIdRef.current = null;
    setActiveBoardPieceId(null);
    setBoardDraft(null);
    setIsBoardNumberEditMode(false);
    setIsBoardGroupMove(false);
    setBoardSelectedPieceIds([]);
  }, [isBoardOpen]);

  useEffect(() => {
    if (!isBoardOpen || !isTouchLayout) {
      setBoardScrollIndicator((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }

    const raf = window.requestAnimationFrame(updateBoardScrollIndicator);
    const onResize = () => updateBoardScrollIndicator();
    window.addEventListener('resize', onResize);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [isBoardNumberEditMode, isBoardOpen, isTouchLayout, updateBoardScrollIndicator]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(max-width: 1024px), (pointer: coarse)');
    const landscapeQuery = window.matchMedia('(orientation: landscape)');
    const updateLayout = () => {
      const isTouch = mediaQuery.matches;
      const shortestSide = Math.min(window.innerWidth, window.innerHeight);
      setIsTouchLayout(isTouch);
      setIsCompactTouchLayout(isTouch && shortestSide <= COMPACT_TOUCH_MAX_SHORT_SIDE_PX);
      setIsTouchLandscape(isTouch && landscapeQuery.matches);
    };

    updateLayout();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateLayout);
      landscapeQuery.addEventListener('change', updateLayout);
    } else {
      mediaQuery.addListener(updateLayout);
      landscapeQuery.addListener(updateLayout);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', updateLayout);
        landscapeQuery.removeEventListener('change', updateLayout);
      } else {
        mediaQuery.removeListener(updateLayout);
        landscapeQuery.removeListener(updateLayout);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCompactTouchLayout) {
      setIsMobileThicknessOpen(false);
      setIsMobileShapeMenuOpen(false);
    }
    if (!isTouchLayout) {
      setIsTopTouchBarCollapsed(false);
    }
  }, [isCompactTouchLayout, isTouchLayout]);

  useEffect(() => {
    if (!isCompactTouchLayout) return;
    if (activeTool !== 'freehand') {
      setIsMobileThicknessOpen(false);
    }
    if (!MOBILE_SHAPE_TOOL_SET.has(activeTool)) {
      setIsMobileShapeMenuOpen(false);
    }
  }, [activeTool, isCompactTouchLayout]);

  useEffect(() => {
    if (isImmersiveMode) {
      setIsImmersiveControlsVisible(true);
    }
  }, [isImmersiveMode]);

  useEffect(() => {
    if (canDraw) return;
    currentDraftRef.current = null;
    circleStartRef.current = null;
    setCurrentDraft(null);
  }, [canDraw]);

  useEffect(() => {
    if (!sessionId) return;
    if (!isDisplayMode && !isDemoMode && !user?.id) return;
    if (isDemoMode && !demoGuestId) return;

    const socket = io(socketUrl, {
      transports: ['websocket'],
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('session:join', {
        sessionId,
        userId: userIdForSocket,
        color: myColor,
        mode: isDisplayMode ? 'display' : 'participant',
      });
    });

    socket.on('session:state', (state: SessionStatePayload) => {
      setParticipants(dedupeParticipants(state.participants || []));
      setDrawings(state.drawings || []);
      setRemoteDrafts({});
      setRedoStack([]);
      if (state.boardState) {
        applyIncomingBoardState(state.boardState);
      }
      if (typeof state.boardOpen === 'boolean') {
        applyBoardVisibility(state.boardOpen, 'remote');
      }
      if (state.videoState) {
        applyVideoSync(state.videoState);
      }
    });

    socket.on('session:user_joined', (participant: SessionParticipant) => {
      setParticipants((prev) => mergeParticipant(prev, participant));
    });

    socket.on('session:participant_updated', (participant: SessionParticipant) => {
      setParticipants((prev) => mergeParticipant(prev, participant));
    });

    socket.on('session:user_left', (leftUserId: string) => {
      setParticipants((prev) => prev.filter((p) => p.userId !== leftUserId));
    });

    socket.on('video:sync', (state: VideoSyncState) => {
      applyVideoSync(state);
    });

    socket.on('board:visibility', (state: { isOpen?: boolean }) => {
      if (typeof state?.isOpen === 'boolean') {
        applyBoardVisibility(state.isOpen, 'remote');
      }
    });

    socket.on('board:state', (state: BoardState | null | undefined) => {
      applyIncomingBoardState(state);
    });

    socket.on('board:labels', (labels: BoardPieceLabels | null | undefined) => {
      if (!labels) return;
      setBoardPieces((prev) => applyBoardPieceLabels(prev, labels));
      setBoardLabelsDirty(false);
    });

    socket.on('draw:broadcast', (incoming: SessionDrawing) => {
      if (!incoming?.id) return;

      if (incoming.isDraft) {
        setRemoteDrafts((prev) => ({ ...prev, [incoming.id]: incoming }));
        return;
      }

      setRemoteDrafts((prev) => {
        const next = { ...prev };
        delete next[incoming.id];
        return next;
      });

      setDrawings((prev) => {
        if (prev.some((item) => item.id === incoming.id)) {
          return prev.map((item) => (item.id === incoming.id ? incoming : item));
        }
        return [...prev, incoming];
      });
    });

    socket.on('draw:undo', (drawingId: string) => {
      setDrawings((prev) => prev.filter((item) => item.id !== drawingId));
      setRemoteDrafts((prev) => {
        const next = { ...prev };
        delete next[drawingId];
        return next;
      });
    });

    socket.on('draw:clear', () => {
      setDrawings([]);
      setRemoteDrafts({});
      setRedoStack([]);
      currentDraftRef.current = null;
      setCurrentDraft(null);
    });

    return () => {
      socket.emit('session:leave', sessionId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applyBoardVisibility, applyIncomingBoardState, applyVideoSync, isDisplayMode, isDemoMode, demoGuestId, sessionId, socketUrl, userIdForSocket]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const t = Number(player.getCurrentTime?.() || 0);
      const d = Number(player.getDuration?.() || 0);

      if (!Number.isNaN(d) && d > 0 && isPlaying && t >= d - 0.15) {
        handleVideoEnd();
        return;
      }

      if (!Number.isNaN(t)) setCurrentTime(t);
      if (!Number.isNaN(d) && d > 0) setDuration(d);
    }, 250);

    return () => window.clearInterval(timer);
  }, [handleVideoEnd, isPlaying]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const levels = syncQualityLevels(player);
      if (qualityPreference === 'max' && levels.length > 0) {
        applyQualityPreference('max', player);
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [applyQualityPreference, qualityPreference, syncQualityLevels]);

  useEffect(() => {
    setQualityPreference('max');
    setIsQualityMenuOpen(false);

    const player = playerRef.current;
    if (player) {
      applyQualityPreference('max', player);
    }
  }, [applyQualityPreference, session?.youtubeVideoId, sessionId]);

  const renderPlaybackRateControl = (keyPrefix: string) => (
    <div className="flex items-center gap-2 rounded-full border border-[#2c5a61] bg-[#08141b] px-2.5 py-0.5">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/55">
        {text.speed}
      </span>
      <div className="relative">
        <select
          value={String(playbackRate)}
          onChange={(e) => handlePlaybackRate(Number(e.target.value))}
          className="min-w-[72px] appearance-none bg-transparent py-1 pl-0 pr-5 text-sm font-black text-[#88fdef] outline-none"
          aria-label={text.speed}
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={`${keyPrefix}-${rate}`} value={String(rate)}>
              {rate}x
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
      </div>
    </div>
  );

  const renderQualityControl = (keyPrefix: string) => (
    <div className="relative" data-quality-menu="1">
      {isQualityMenuOpen && (
        <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[170px] rounded-[18px] border border-[#2c5d63] bg-[linear-gradient(180deg,rgba(13,24,33,0.98),rgba(7,18,24,0.98))] p-2 shadow-[0_22px_50px_rgba(0,0,0,0.46)] backdrop-blur-xl">
          <div className="flex flex-col gap-1">
            {qualityOptions.map((option) => {
              const isActive = qualityPreference === option.value;
              return (
                <button
                  key={`${keyPrefix}-${option.value}`}
                  type="button"
                  onClick={() => {
                    handleQualityChange(option.value);
                    setIsQualityMenuOpen(false);
                  }}
                  className={`inline-flex h-9 items-center justify-between rounded-[12px] px-3 text-left text-[12px] font-black uppercase tracking-[0.12em] transition-colors ${
                    isActive
                      ? 'bg-[#63f6e7]/18 text-[#8efdf1]'
                      : 'bg-transparent text-white/78 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span>{option.label}</span>
                  {isActive && <span className="text-[#63f6e7]">•</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsQualityMenuOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-[#2c5d63] bg-[#0d1821] px-3 text-[11px] font-black uppercase tracking-[0.14em] text-[#8efdf1] transition-colors hover:bg-[#12212d]"
      >
        {text.quality}
        <ChevronDown className={`h-4 w-4 transition-transform ${isQualityMenuOpen ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-premier-pink border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white/60">{text.loadingSession}</p>
        </div>
      </div>
    );
  }

  if (!isDisplayMode && !isDemoMode && !authLoading && !user?.id) {
    const redirectPath = session ? `/session/${session.id}` : `/session/${sessionId || ''}`;
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white/5 border border-white/10 rounded-2xl p-8">
          <h1 className="text-2xl font-black uppercase mb-3">{text.loginRequired}</h1>
          <p className="text-white/70 mb-6">{text.loginRequiredText}</p>
          <div className="flex gap-3">
            <Link
              href={`/auth/login?redirect=${encodeURIComponent(redirectPath)}`}
              className="btn-primary px-5 py-2"
            >
              {text.signIn}
            </Link>
            <Link
              href={`/auth/register?redirect=${encodeURIComponent(redirectPath)}`}
              className="px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              {text.createAccount}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!session || error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white/5 border border-white/10 rounded-2xl p-8">
          <h1 className="text-2xl font-black uppercase mb-3">{text.sessionNotAvailable}</h1>
          <p className="text-red-400 mb-6">{error || text.sessionNotFound}</p>
          <div className="flex gap-3">
            <button onClick={loadSession} className="btn-primary px-5 py-2">
              {text.retry}
            </button>
            <Link href="/dashboard" className="px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
              {text.backToDashboard}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const participantsCountLabel = `${participants.length}/${session.maxParticipants}`;
  const isTabletTouchLayout = isTouchLayout && !isCompactTouchLayout;
  const isTabletInlineLayout = isTabletTouchLayout && !isImmersiveMode;
  const boardControlButtonClass = isTouchLayout
    ? 'px-3 py-1.5 rounded-lg text-xs font-semibold'
    : 'px-4 py-2 rounded-lg text-sm font-semibold';
  const boardFieldStyle: React.CSSProperties = isTouchLayout
    ? {
        width: '100%',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }
    : {
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      };
  const leftToolbarWrapperClass = isTabletTouchLayout
    ? 'absolute left-0 z-40 flex items-start'
    : `absolute left-4 ${isImmersiveMode ? 'top-16' : 'top-4'} z-40`;
  const leftToolbarWrapperStyle: React.CSSProperties | undefined = isTabletTouchLayout
    ? {
        top: isImmersiveMode ? 'clamp(54px, 8vh, 72px)' : 'clamp(8px, 1.6vh, 12px)',
        bottom: isImmersiveMode ? 'clamp(116px, 18vh, 142px)' : 'clamp(86px, 12vh, 104px)',
      }
    : undefined;
  const fullToolbarShellClass = isTabletInlineLayout
    ? 'w-[clamp(48px,5.6vw,56px)] space-y-[clamp(4px,0.6vh,6px)] rounded-r-[20px] rounded-l-none border border-l-0 border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.94),rgba(6,14,19,0.98))] px-[clamp(4px,0.6vw,5px)] py-[clamp(5px,0.7vh,6px)] shadow-[0_18px_44px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl'
    : isTabletTouchLayout
      ? 'w-[clamp(58px,6.6vw,68px)] max-h-full space-y-[clamp(6px,0.9vh,8px)] rounded-r-[24px] rounded-l-none border border-l-0 border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.94),rgba(6,14,19,0.98))] px-[clamp(5px,0.8vw,7px)] py-[clamp(6px,1vh,8px)] shadow-[0_22px_60px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl'
    : 'w-[72px] space-y-2 rounded-[24px] border border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.92),rgba(6,14,19,0.98))] px-2 py-2 shadow-[0_22px_60px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl';
  const fullToolbarGroupClass = isTabletInlineLayout ? 'space-y-[3px]' : isTabletTouchLayout ? 'space-y-[clamp(4px,0.8vh,6px)]' : 'space-y-1';
  const fullToolbarToolButtonClass = isTabletInlineLayout
    ? 'inline-flex h-[clamp(30px,3.8vh,34px)] w-full items-center justify-center rounded-[12px] border transition-all'
    : isTabletTouchLayout
      ? 'inline-flex h-[clamp(38px,5vh,46px)] w-full items-center justify-center rounded-[14px] border transition-all'
    : 'inline-flex h-12 w-full items-center justify-center rounded-[16px] border transition-all';
  const fullToolbarThicknessButtonClass = isTabletInlineLayout
    ? 'h-[clamp(22px,3vh,26px)] w-full rounded-[9px] border'
    : isTabletTouchLayout
      ? 'h-[clamp(30px,4.2vh,36px)] w-full rounded-[11px] border'
    : 'h-9 w-full rounded-[12px] border';
  const fullToolbarActionButtonClass = isTabletInlineLayout
    ? 'inline-flex h-[clamp(24px,3.2vh,28px)] w-full items-center justify-center rounded-[10px] border'
    : isTabletTouchLayout
      ? 'inline-flex h-[clamp(34px,4.6vh,40px)] w-full items-center justify-center rounded-[12px] border'
    : 'inline-flex h-10 w-full items-center justify-center rounded-[13px] border';
  const fullToolbarToolIconClass = isTabletInlineLayout
    ? 'h-[clamp(16px,2.2vh,18px)] w-[clamp(16px,2.2vh,18px)]'
    : isTabletTouchLayout
      ? 'h-[clamp(20px,2.7vh,24px)] w-[clamp(20px,2.7vh,24px)]'
    : 'w-6 h-6';
  const fullToolbarActionIconClass = isTabletInlineLayout
    ? 'h-[clamp(14px,1.9vh,16px)] w-[clamp(14px,1.9vh,16px)]'
    : isTabletTouchLayout
      ? 'h-[clamp(18px,2.4vh,20px)] w-[clamp(18px,2.4vh,20px)]'
    : 'w-5 h-5';
  const showBoardOverlayHeader = !isDisplayMode;
  const timelineEditorModal = isTimelineEditorOpen ? (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/72 px-3 py-4 backdrop-blur-sm"
      onClick={() => setIsTimelineEditorOpen(false)}
    >
      <div
        className="w-full max-w-[560px] rounded-[28px] border border-[#2d5960]/65 bg-[linear-gradient(180deg,rgba(9,22,29,0.98),rgba(5,12,18,0.96))] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#8efdf1]">{text.timelineEditorTitle}</h3>
            <p className="mt-1 text-xs font-semibold text-white/45">{timelineMarkers.length}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTimelineDeleteAll}
              disabled={timelineMarkers.length === 0}
              className="rounded-full border border-[#5b2d32] bg-[#261116] px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-[#ff9aa2] transition-colors hover:bg-[#33161c] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {text.timelineDeleteAll}
            </button>
            <button
              type="button"
              onClick={() => setIsTimelineEditorOpen(false)}
              className="rounded-full border border-[#2c5a61] bg-[#08141b] px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              {text.closeModal}
            </button>
          </div>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {timelineMarkers.length === 0 ? (
            <div className="rounded-2xl border border-[#244e54] bg-[#08141b] px-4 py-5 text-sm text-white/60">
              {text.timelineEditorEmpty}
            </div>
          ) : (
            timelineMarkers.map((marker) => {
              const markerStyle = TIMELINE_MARKER_STYLE[marker.type];
              return (
                <div
                  key={`timeline-editor-${marker.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-[#244e54] bg-[#08141b] px-3 py-3"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#0d2729]">
                    <TimelineMarkerIcon type={marker.type} color={markerStyle.color} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-white/85">{timelineMarkerTypeLabels[marker.type]}</p>
                    <p className="mt-1 text-xs font-semibold tracking-[0.12em] text-white/45">
                      {formatSecondsToClock(marker.time)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTimelineMarkerDelete(marker.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-[#5b2d32] bg-[#261116] px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-[#ff9aa2] transition-colors hover:bg-[#33161c]"
                  >
                    <Trash2 className="h-4 w-4" />
                    {text.timelineDelete}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  ) : null;
  const boardOverlay = isBoardOpen ? (
    <div
      ref={boardOverlayScrollRef}
      onScroll={updateBoardScrollIndicator}
      className={`fixed inset-0 z-[120] bg-black/82 backdrop-blur-sm overflow-y-auto ${isTouchLayout ? 'p-2' : 'px-3 py-2 sm:px-6 sm:py-3'}`}
      style={
        isTouchLayout
          ? {
              ...(isTouchLandscape ? { paddingRight: 'calc(1cm + 0.5rem)' } : {}),
              touchAction: 'pan-y',
              WebkitOverflowScrolling: 'touch',
            }
          : undefined
      }
    >
      <div className={`w-full space-y-2 mx-auto ${isTouchLayout ? 'max-w-none my-0' : 'max-w-[1300px] my-0'}`}>
        {showBoardOverlayHeader && (
          <div className={`rounded-2xl border border-white/20 bg-black/70 ${isTouchLayout ? 'p-2' : 'p-2 sm:p-3'}`}>
            <div className={isTouchLayout ? '' : 'overflow-x-auto'}>
              <div className={isTouchLayout ? 'flex flex-wrap items-center gap-2' : 'flex items-center gap-2 min-w-max'}>
                <button
                  onClick={() => setBoardMode('move')}
                  className={`${boardControlButtonClass} ${
                    boardMode === 'move' ? 'bg-premier-cyan text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {text.boardMoveMode}
                </button>
                <button
                  onClick={() => setBoardMode((prev) => (prev === 'draw' ? 'move' : 'draw'))}
                  className={`${boardControlButtonClass} ${
                    boardMode === 'draw' ? 'bg-premier-pink text-white' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {text.boardDrawMode}
                </button>
                <button
                  onClick={() =>
                    setIsBoardGroupMove((prev) => {
                      const next = !prev;
                      if (!next) setBoardSelectedPieceIds([]);
                      if (next) setIsBoardNumberEditMode(false);
                      return next;
                    })
                  }
                  disabled={boardMode !== 'move' || isBoardNumberEditMode}
                  className={`${boardControlButtonClass} ${
                    isBoardGroupMove ? 'bg-premier-cyan text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isBoardGroupMove ? text.boardGroupMoveOn : text.boardGroupMove}
                </button>
                <button
                  onClick={() => setBoardSelectedPieceIds([])}
                  disabled={!isBoardGroupMove || boardSelectedPieceIds.length === 0}
                  className={`${boardControlButtonClass} bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {text.boardClearSelection}
                </button>
                <button
                  onClick={() => void handleToggleBoardNumberEditMode()}
                  disabled={boardMode !== 'move' || !canManageBoardLabels}
                  className={`${boardControlButtonClass} ${
                    isBoardNumberEditMode ? 'bg-amber-300 text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isBoardNumberEditMode ? text.boardFinishEditNumbers : text.boardEditNumbers}
                </button>
                <button
                  onClick={() => {
                    boardDraftRef.current = null;
                    boardDrawPointerIdRef.current = null;
                    setBoardDraft(null);
                    setBoardDrawings([]);
                    setBoardStateDirty(true);
                  }}
                  className={`${boardControlButtonClass} bg-white/10 text-white hover:bg-white/20`}
                >
                  {text.boardClearDrawings}
                </button>
                <button
                  onClick={() => {
                    if (!canManageBoardLabels) return;
                    setBoardPieces((prev) => resetBoardPiecePositions(prev));
                    setBoardStateDirty(true);
                  }}
                  disabled={!canManageBoardLabels}
                  className={`${boardControlButtonClass} bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {text.boardReset}
                </button>
                <button
                  onClick={() => void handleCloseBoard()}
                  className={`${boardControlButtonClass} bg-red-600 text-white hover:bg-red-500`}
                >
                  {text.closeBoard}
                </button>
              </div>
            </div>
            <p className="text-xs text-white/65 mt-2 px-1">{text.boardHint}</p>
          </div>
        )}

        {showBoardOverlayHeader && isBoardNumberEditMode && canManageBoardLabels && (
          <div className="rounded-2xl border border-white/20 bg-black/70 p-3 sm:p-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3">
              <p className="text-sm font-bold text-red-200 mb-2">{text.teamRed}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {boardTeamList.red.map((piece) => (
                  <label key={`board-red-${piece.id}`} className="flex flex-col gap-1">
                    <span className="text-[11px] text-white/60">#{piece.id.split('-')[1]}</span>
                    <input
                      value={piece.label}
                      onChange={(event) => handleBoardLabelInputChange(piece.id, event.target.value)}
                      maxLength={3}
                      className="w-full h-9 rounded-md border border-white/20 bg-black/55 px-2 text-center text-sm font-semibold text-white"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-yellow-300/35 bg-yellow-500/10 p-3">
              <p className="text-sm font-bold text-yellow-100 mb-2">{text.teamYellow}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {boardTeamList.yellow.map((piece) => (
                  <label key={`board-yellow-${piece.id}`} className="flex flex-col gap-1">
                    <span className="text-[11px] text-white/60">#{piece.id.split('-')[1]}</span>
                    <input
                      value={piece.label}
                      onChange={(event) => handleBoardLabelInputChange(piece.id, event.target.value)}
                      maxLength={3}
                      className="w-full h-9 rounded-md border border-white/20 bg-black/55 px-2 text-center text-sm font-semibold text-white"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div
          ref={boardAreaRef}
          className="relative mx-auto w-full max-w-[1120px] aspect-[16/9] rounded-[28px] border-2 border-white/30 overflow-hidden touch-none select-none bg-gradient-to-b from-[#2f8d46] to-[#1e6533] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
          style={boardFieldStyle}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="absolute inset-[3%] border-2 border-white/80 rounded-lg" />
          <div className="absolute top-[3%] bottom-[3%] left-1/2 w-[2px] bg-white/80 -translate-x-1/2" />
          <div className="absolute left-1/2 top-1/2 w-[20%] aspect-square border-2 border-white/80 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute left-[3%] top-[30%] w-[12%] h-[40%] border-2 border-white/80 rounded-r-md" />
          <div className="absolute right-[3%] top-[30%] w-[12%] h-[40%] border-2 border-white/80 rounded-l-md" />
          <div className="absolute left-[3%] top-[40%] w-[5%] h-[20%] border-2 border-white/80 rounded-r-md" />
          <div className="absolute right-[3%] top-[40%] w-[5%] h-[20%] border-2 border-white/80 rounded-l-md" />

          <canvas
            ref={boardCanvasRef}
            className={`absolute inset-0 z-20 ${boardMode === 'draw' ? 'pointer-events-auto' : 'pointer-events-none'}`}
            onPointerDown={handleBoardCanvasPointerDown}
            onPointerMove={handleBoardCanvasPointerMove}
            onPointerUp={handleBoardCanvasPointerUp}
            onPointerCancel={handleBoardCanvasPointerUp}
          />

          {boardPieces.map((piece) => {
            const isBall = piece.team === 'ball';
            const pieceSize = Math.round((isBall ? 32 : 44) * boardPieceScale);
            const pieceFontSize = Math.round((isBall ? 12 : 15) * boardPieceScale);
            return (
              <button
                key={piece.id}
                type="button"
                onPointerDown={(event) => handleBoardPiecePointerDown(piece.id, event)}
                onPointerMove={(event) => handleBoardPiecePointerMove(piece.id, event)}
                onPointerUp={(event) => handleBoardPiecePointerUp(piece.id, event)}
                onPointerCancel={(event) => handleBoardPiecePointerUp(piece.id, event)}
                disabled={boardMode !== 'move'}
                className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 font-black ${getBoardPieceClassName(piece.team)} ${
                  boardMode !== 'move' ? 'opacity-70 cursor-not-allowed pointer-events-none' : 'cursor-grab active:cursor-grabbing'
                } ${isBoardGroupMove && boardSelectedSet.has(piece.id) ? 'outline outline-2 outline-cyan-300 outline-offset-2' : ''} ${
                  activeBoardPieceId === piece.id ? 'outline outline-2 outline-blue-400 outline-offset-2' : ''
                } ${isBoardNumberEditMode && piece.team !== 'ball' ? 'ring-2 ring-amber-300' : ''}`}
                style={{
                  left: `${piece.x * 100}%`,
                  top: `${piece.y * 100}%`,
                  width: `${pieceSize}px`,
                  height: `${pieceSize}px`,
                  fontSize: `${Math.max(10, pieceFontSize)}px`,
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}
                onContextMenu={(event) => event.preventDefault()}
                title={piece.team === 'ball' ? 'Ball' : `Player ${piece.label}`}
              >
                {piece.label}
              </button>
            );
          })}
        </div>
      </div>
      {isTouchLayout && boardScrollIndicator.visible && (
        <>
          <div className="pointer-events-none fixed top-2 bottom-2 right-1.5 z-[131] w-5 rounded-full border-2 border-[#15c7a8]/80 bg-black/75 shadow-[0_0_20px_rgba(21,199,168,0.25)]">
            <div
              className="absolute left-[2px] right-[2px] rounded-full bg-[#15c7a8] shadow-[0_0_14px_rgba(21,199,168,0.9)]"
              style={{
                height: `${boardScrollIndicator.height}px`,
                transform: `translateY(${boardScrollIndicator.top}px)`,
              }}
            />
          </div>
          <div className="pointer-events-none fixed right-8 top-1/2 -translate-y-1/2 z-[131] px-2 py-1 rounded-md border border-[#15c7a8]/50 bg-black/80 text-[10px] font-black uppercase tracking-[0.08em] text-[#15c7a8]">
            Скролл
          </div>
        </>
      )}
    </div>
  ) : null;

  if (isDisplayMode) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-2">
        <div className="w-full max-w-[1600px]">
          <div
            ref={wrapperRef}
            className={`bg-black overflow-hidden ${
              isPseudoFullscreen ? 'fixed inset-0 z-[80]' : 'relative w-full aspect-video rounded-lg'
            }`}
            style={VIDEO_INTERACTION_SURFACE_STYLE}
            onDoubleClick={(event) => event.preventDefault()}
          >
            {showSessionDemoTimer && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                <div className="px-4 py-1.5 rounded-full bg-black/60 border border-ucl-gold/75 text-ucl-gold text-sm font-black tabular-nums shadow-[0_6px_24px_rgba(0,0,0,0.45)]">
                  {demoTimerLabel}
                </div>
              </div>
            )}
            <button
              onClick={handleToggleFullscreen}
              className="absolute top-3 right-3 z-30 px-3 py-1 rounded bg-black/60 hover:bg-black/80 text-white text-xs"
            >
              {isImmersiveMode ? text.exitFullscreen : text.fullscreen}
            </button>

            <YouTube
              key={`display-${youtubeHost}`}
              videoId={session.youtubeVideoId}
              opts={youtubePlayerOpts}
              className="absolute inset-0 w-full h-full"
              iframeClassName="w-full h-full"
              onReady={handlePlayerReady}
              onStateChange={handlePlayerStateChange}
              onError={handlePlayerError}
              onEnd={handleVideoEnd}
            />

            {showYoutubeThumbnailOverlay && youtubeThumbnailUrl && (
              <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
                <img
                  src={youtubeThumbnailUrl}
                  alt={session.name}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                <div className="absolute inset-0 bg-black/20" />
              </div>
            )}

            {/* Guard zone over YouTube "Watch later / Share" controls in top-right */}
            <div className="absolute top-0 right-0 z-20 w-[176px] h-[44px] bg-black/45 pointer-events-auto rounded-bl-lg" aria-hidden="true" />

            {videoError && (
              <div className="absolute top-3 left-3 right-3 z-40 rounded-md border border-red-400/50 bg-red-950/85 px-3 py-2 text-xs font-semibold text-red-100 sm:text-sm">
                {videoError}
              </div>
            )}

            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
            {isImmersiveMode && boardOverlay}
          </div>
          {!isImmersiveMode && boardOverlay}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#03070c] bg-[radial-gradient(circle_at_top,rgba(20,60,72,0.28),transparent_38%),radial-gradient(circle_at_85%_18%,rgba(29,104,122,0.14),transparent_28%),linear-gradient(180deg,#02050a_0%,#081018_100%)] px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <header className="rounded-[28px] border border-[#3ce7d2]/15 bg-[linear-gradient(180deg,rgba(11,22,30,0.95),rgba(6,13,19,0.9))] px-4 py-4 shadow-[0_22px_80px_rgba(0,0,0,0.42)] sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#56f2e0]/30 bg-[#0a141c]/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-[#81fff1]">
                  {text.session}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/65">
                  {text.users} {participantsCountLabel}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-black uppercase tracking-[0.14em] text-white sm:text-2xl lg:text-[2rem]">
                  {session.name}
                </h1>
                <p className="mt-1 max-w-[760px] text-sm text-[#8ba4ad] sm:text-[15px]">
                  {text.coachUiSubtitle}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                user?.plan === 'pro'
                  ? 'border-[#4df8e6]/35 bg-[#4df8e6]/12 text-[#7afef1]'
                  : user?.plan === 'coach'
                    ? 'border-[#d8c05e]/35 bg-[#d8c05e]/12 text-[#e9d886]'
                    : 'border-white/10 bg-white/[0.05] text-white/60'
              }`}>
                {user?.plan || text.viewer}
              </span>

              <Link
                href={`/display/${session.id}`}
                target="_blank"
                className="rounded-full border border-[#2c6267] bg-[#0b171d] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#8cf7ea] transition-colors hover:bg-[#10212a]"
              >
                {text.openDisplay}
              </Link>

              <Link
                href="/dashboard"
                className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-white/[0.11]"
              >
                {text.exit}
              </Link>
            </div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <section className="rounded-[34px] border border-[#28535a]/55 bg-[linear-gradient(180deg,rgba(7,19,24,0.98),rgba(5,12,18,0.95))] p-2 shadow-[0_28px_110px_rgba(0,0,0,0.48)] sm:p-3 lg:p-4">
              <div className="rounded-[28px] border border-[#132d33] bg-[linear-gradient(180deg,rgba(6,14,20,0.98),rgba(4,10,14,0.92))] p-2 sm:p-3">
                <div
                  ref={wrapperRef}
                  className={`bg-black overflow-hidden ${
                    isPseudoFullscreen
                      ? 'fixed inset-0 z-[80]'
                      : 'relative w-full aspect-video rounded-[28px] border border-[#77f9e7]/20 shadow-[0_36px_120px_rgba(0,0,0,0.5)]'
                  }`}
                  style={VIDEO_INTERACTION_SURFACE_STYLE}
                  onDoubleClick={(event) => event.preventDefault()}
                >
                  <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_top,rgba(0,0,0,0.06),transparent_35%),linear-gradient(180deg,rgba(3,9,14,0.18),transparent_22%,transparent_78%,rgba(2,8,12,0.38)_100%)]" />
                  <div className="pointer-events-none absolute inset-0 z-[2] shadow-[inset_0_0_0_1px_rgba(110,255,240,0.14),inset_0_-72px_120px_rgba(0,0,0,0.36)]" />
              {showSessionDemoTimer && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                  <div className="rounded-full border border-[#d8c05e]/55 bg-black/65 px-4 py-1.5 text-sm font-black tabular-nums text-[#e8d37f] shadow-[0_6px_24px_rgba(0,0,0,0.45)]">
                    {demoTimerLabel}
                  </div>
                </div>
              )}
              <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
                {showTopActionBar && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => setIsCanvasEnabled((prev) => !prev)}
                      className={`h-9 rounded-full border border-white/12 px-3 text-[11px] font-black uppercase tracking-[0.16em] inline-flex items-center gap-2 backdrop-blur-md transition-colors ${
                        isCanvasEnabled
                          ? 'bg-[#63f6e7] text-[#021013] hover:bg-[#8af9ed]'
                          : 'bg-black/55 text-white/80 hover:bg-black/70'
                      }`}
                      title={text.canvasToggleTitle}
                    >
                      {isCanvasEnabled ? <PencilLine className="h-4 w-4 flex-shrink-0" /> : <Slash className="h-4 w-4 flex-shrink-0" />}
                      <span className="hidden sm:inline">{isCanvasEnabled ? text.canvasOn : text.canvasOff}</span>
                    </button>

                    <button
                      onClick={handleToggleFullscreen}
                      className="inline-flex items-center gap-2 bg-transparent px-0 py-0 text-[11px] font-black uppercase tracking-[0.16em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.75)] transition-opacity hover:opacity-80"
                    >
                      {isImmersiveMode ? <Minimize2 className="h-4 w-4 flex-shrink-0" /> : <Maximize2 className="h-4 w-4 flex-shrink-0" />}
                      <span className="hidden sm:inline">{isImmersiveMode ? text.exitFullscreen : text.fullscreen}</span>
                    </button>
                  </div>
                )}

                {isTouchLayout && (
                  <button
                    onClick={() => setIsTopTouchBarCollapsed((prev) => !prev)}
                    className="h-10 w-10 rounded-full border border-white/10 bg-[#071118]/82 text-white inline-flex items-center justify-center backdrop-blur-md transition-colors hover:bg-[#0d1821]"
                    title={showTopActionBar ? text.hideControls : text.showControls}
                  >
                    {showTopActionBar ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
                )}
              </div>

              {!isDisplayMode && (!isImmersiveMode || showImmersiveControls || isTouchLayout) && (
                <>
                  <div className={leftToolbarWrapperClass} style={leftToolbarWrapperStyle}>
                    {isCompactTouchLayout ? (
                      <div className="flex items-start gap-2">
                        <div className="w-[58px] space-y-1 rounded-[22px] border border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.92),rgba(6,14,19,0.98))] px-1.5 py-2 shadow-[0_22px_60px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl">
                          <div className="space-y-1">
                            <button
                              onClick={handleMobilePencilSelect}
                              disabled={!canDraw}
                              className={`inline-flex h-10 w-full items-center justify-center rounded-[14px] border transition-all ${
                                activeTool === 'freehand'
                                  ? 'border-[#8cfff2]/75 bg-[#12343a]/96 text-[#98fff4] shadow-[0_0_28px_rgba(102,255,237,0.22)]'
                                  : 'border-transparent bg-[#0b161d]/78 text-[#85f6ea] hover:border-[#69f7e5]/35 hover:bg-[#112029]/92'
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={`${toolLabels.freehand} (B)`}
                            >
                              <ToolIcon tool="freehand" className="w-5 h-5" />
                            </button>

                            <button
                              onClick={handleMobileShapeMenuToggle}
                              disabled={!canDraw}
                              className={`inline-flex h-10 w-full items-center justify-center rounded-[14px] border transition-all ${
                                isShapeToolActive || isMobileShapeMenuOpen
                                  ? 'border-[#8cfff2]/75 bg-[#12343a]/96 text-[#98fff4] shadow-[0_0_28px_rgba(102,255,237,0.22)]'
                                  : 'border-transparent bg-[#0b161d]/78 text-[#85f6ea] hover:border-[#69f7e5]/35 hover:bg-[#112029]/92'
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={`${toolLabels.arrow} / ${toolLabels.circle} / ${toolLabels.line}`}
                            >
                              <ToolIcon tool={activeShapeTool} className="w-5 h-5" />
                            </button>

                            <button
                              onClick={() => handleToolSelect('text')}
                              disabled={!canDraw}
                              className={`inline-flex h-10 w-full items-center justify-center rounded-[14px] border transition-all ${
                                activeTool === 'text'
                                  ? 'border-[#8cfff2]/75 bg-[#12343a]/96 text-[#98fff4] shadow-[0_0_28px_rgba(102,255,237,0.22)]'
                                  : 'border-transparent bg-[#0b161d]/78 text-[#85f6ea] hover:border-[#69f7e5]/35 hover:bg-[#112029]/92'
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={`${toolLabels.text} (T)`}
                            >
                              <ToolIcon tool="text" className="w-5 h-5" />
                            </button>
                          </div>
                        </div>

                        {isMobileThicknessOpen && (
                          <div className="w-[58px] space-y-1 rounded-[22px] border border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.92),rgba(6,14,19,0.98))] px-1.5 py-2 shadow-[0_22px_60px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl">
                            {[2, 4, 6].map((w) => (
                              <button
                                key={`left-mobile-thickness-freehand-${w}`}
                                onClick={() => handleThicknessSelect(w)}
                                disabled={!canDraw}
                                className={`h-10 w-full rounded-[14px] border transition-colors ${
                                  lineThickness === w ? 'border-[#8cfff2]/65 bg-[#12343a]/96' : 'border-transparent bg-[#0b161d]/78 hover:border-[#69f7e5]/35 hover:bg-[#112029]/92'
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                                title={`${text.thickness} ${w}px`}
                              >
                                <span className="block bg-white mx-auto rounded" style={{ width: '20px', height: `${Math.max(2, Math.min(6, w))}px` }} />
                              </button>
                            ))}
                          </div>
                        )}

                        {isMobileShapeMenuOpen && (
                          <div className="w-[58px] space-y-1 rounded-[22px] border border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.92),rgba(6,14,19,0.98))] px-1.5 py-2 shadow-[0_22px_60px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl">
                            {MOBILE_SHAPE_TOOLS.map((tool) => (
                              <button
                                key={`left-mobile-shape-${tool}`}
                                onClick={() => handleMobileShapeSelect(tool)}
                                disabled={!canDraw}
                                className={`inline-flex h-10 w-full items-center justify-center rounded-[14px] border transition-all ${
                                  activeTool === tool
                                    ? 'border-[#8cfff2]/75 bg-[#12343a]/96 text-[#98fff4] shadow-[0_0_28px_rgba(102,255,237,0.22)]'
                                    : 'border-transparent bg-[#0b161d]/78 text-[#85f6ea] hover:border-[#69f7e5]/35 hover:bg-[#112029]/92'
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                                title={toolLabels[tool]}
                              >
                                <ToolIcon tool={tool} className="w-5 h-5" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className={fullToolbarShellClass}>
                          <div className={fullToolbarGroupClass}>
                            {TOOL_OPTIONS.map(({ tool, shortcut }) => (
                              <button
                                key={`left-${tool}`}
                                onClick={() => handleToolSelect(tool)}
                                disabled={!canDraw}
                                className={`${fullToolbarToolButtonClass} ${
                                  activeTool === tool
                                    ? 'border-[#8cfff2]/75 bg-[#12343a]/96 text-[#98fff4] shadow-[0_0_28px_rgba(102,255,237,0.22)]'
                                    : 'border-transparent bg-[#0b161d]/78 text-[#85f6ea] hover:border-[#69f7e5]/35 hover:bg-[#112029]/92'
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                                title={`${toolLabels[tool]} (${shortcut})`}
                              >
                                <ToolIcon tool={tool} className={fullToolbarToolIconClass} />
                              </button>
                            ))}
                          </div>

                          <div className="h-px bg-[#77f9e7]/15" />

                          <div className={fullToolbarGroupClass}>
                            {[2, 4, 6].map((w) => (
                              <button
                                key={`left-thickness-${w}`}
                                onClick={() => handleThicknessSelect(w)}
                                disabled={!canDraw}
                                className={`${fullToolbarThicknessButtonClass} ${
                                  lineThickness === w ? 'border-[#8cfff2]/65 bg-[#79ffe9]/16' : 'border-transparent bg-white/[0.04] hover:border-[#69f7e5]/25 hover:bg-white/[0.08]'
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                                title={`${text.thickness} ${w}px`}
                              >
                                <span
                                  className="block bg-white mx-auto rounded"
                                  style={{
                                    width: isTabletTouchLayout ? '18px' : '20px',
                                    height: `${Math.max(2, Math.min(6, w))}px`,
                                  }}
                                />
                              </button>
                            ))}
                          </div>

                          <div className="h-px bg-[#77f9e7]/15" />

                          <div className={fullToolbarGroupClass}>
                            <button
                              onClick={handleUndo}
                              disabled={!canUndo}
                              className={`${fullToolbarActionButtonClass} border-transparent bg-white/[0.04] text-[#8efdf1] transition-colors hover:border-[#69f7e5]/25 hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={text.undoHint}
                            >
                              <Undo2 className={fullToolbarActionIconClass} />
                            </button>
                            <button
                              onClick={handleRedo}
                              disabled={!canRedo}
                              className={`${fullToolbarActionButtonClass} border-transparent bg-white/[0.04] text-[#8efdf1] transition-colors hover:border-[#69f7e5]/25 hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={text.redoHint}
                            >
                              <Redo2 className={fullToolbarActionIconClass} />
                            </button>
                            <button
                              onClick={handleClear}
                              disabled={!canDraw}
                              className={`${fullToolbarActionButtonClass} border-transparent bg-[#5c171d]/45 text-[#ff9da5] transition-colors hover:bg-[#752128]/55 disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={text.clearAll}
                            >
                              <Trash2 className={fullToolbarActionIconClass} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {isCompactTouchLayout && (
                    <div className={`absolute right-4 ${isImmersiveMode ? 'top-20' : 'top-10'} z-40`}>
                      <div className="w-[58px] space-y-1 rounded-[22px] border border-[#8cfff2]/45 bg-[linear-gradient(180deg,rgba(18,40,46,0.92),rgba(6,14,19,0.98))] px-1.5 py-2 shadow-[0_22px_60px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(146,255,244,0.08)] backdrop-blur-xl">
                        <button
                          onClick={handleUndo}
                          disabled={!canUndo}
                          className="inline-flex h-10 w-full items-center justify-center rounded-[14px] border border-transparent bg-white/[0.04] text-[#8efdf1] transition-colors hover:border-[#69f7e5]/25 hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
                          title={text.undoHint}
                        >
                          <Undo2 className="w-5 h-5" />
                        </button>
                        <button
                          onClick={handleClear}
                          disabled={!canDraw}
                          className="inline-flex h-10 w-full items-center justify-center rounded-[14px] border border-transparent bg-[#5c171d]/45 text-[#ff9da5] transition-colors hover:bg-[#752128]/55 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={text.clearAll}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {isImmersiveMode && isTouchLayout && (
                <button
                  onClick={() => setIsImmersiveControlsVisible((prev) => !prev)}
                  className={`absolute top-3 left-3 z-50 h-9 px-4 rounded-lg border border-white/15 backdrop-blur-sm text-sm font-bold inline-flex items-center ${
                    isImmersiveControlsVisible
                      ? 'bg-black/70 hover:bg-black/80 text-white'
                      : 'bg-[#15c7a8] hover:bg-[#3dd9be] text-black'
                  }`}
                >
                  {isImmersiveControlsVisible ? text.hideControls : text.showControls}
                </button>
              )}

              <YouTube
                key={`session-${youtubeHost}`}
                videoId={session.youtubeVideoId}
                opts={youtubePlayerOpts}
                className="absolute inset-0 w-full h-full"
                iframeClassName="w-full h-full"
                onReady={handlePlayerReady}
                onStateChange={handlePlayerStateChange}
                onError={handlePlayerError}
                onEnd={handleVideoEnd}
              />

              {showYoutubeThumbnailOverlay && youtubeThumbnailUrl && (
                <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
                  <img
                    src={youtubeThumbnailUrl}
                    alt={session.name}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-14 rounded-2xl bg-[#ff0033]/90 shadow-[0_18px_48px_rgba(0,0,0,0.4)] flex items-center justify-center">
                      <Play className="w-9 h-9 text-white fill-current ml-1" />
                    </div>
                  </div>
                </div>
              )}

              {/* Guard zone over YouTube "Watch later / Share" controls in top-right */}
              <div className="absolute top-0 right-0 z-20 w-[176px] h-[44px] bg-black/45 pointer-events-auto rounded-bl-lg" aria-hidden="true" />

              {videoError && (
                <div className="absolute top-3 left-3 right-3 z-40 rounded-md border border-red-400/50 bg-red-950/85 px-3 py-2 text-xs font-semibold text-red-100 sm:text-sm">
                  {videoError}
                </div>
              )}

              <canvas
                ref={canvasRef}
                className={`absolute inset-0 transition-opacity ${
                  isCanvasEnabled ? 'opacity-100' : 'opacity-0'
                } touch-none ${canDraw && !isYoutubeClosePassThrough ? 'cursor-crosshair' : 'pointer-events-none'}`}
                style={VIDEO_DRAW_CANVAS_STYLE}
                onContextMenu={(event) => event.preventDefault()}
                onTouchStart={handleCanvasTouchNative}
                onTouchMove={handleCanvasTouchNative}
                onTouchEnd={handleCanvasTouchNative}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onLostPointerCapture={() => finalizeCurrentDraft()}
              />

              {isImmersiveMode && showImmersiveControls && (
                <div className="absolute inset-x-0 bottom-0 z-40 p-2 sm:p-2.5 pointer-events-none">
                  <div className="pointer-events-auto mx-auto max-w-[1480px] rounded-[24px] border border-[#2d5960]/60 bg-[linear-gradient(180deg,rgba(9,22,29,0.9),rgba(5,12,18,0.84))] px-2.5 py-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl sm:px-3 sm:py-2">
                    <div className="relative">
                      <div
                        data-timeline-rail="1"
                        className="relative h-7 overflow-visible rounded-[16px] border border-[#275754]/55 bg-[linear-gradient(180deg,rgba(7,35,31,0.82),rgba(5,24,23,0.92))]"
                        onPointerDown={handleTimelineRailPointerDown}
                        onPointerMove={handleTimelinePointerMove}
                        onPointerUp={handleTimelinePointerUp}
                        onPointerCancel={handleTimelinePointerUp}
                      >
                        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-[#62f7e8]/20" />
                        {DECORATIVE_TIMELINE_COLUMNS.map((column) => {
                          const tone = TIMELINE_TONE_STYLE[column.tone];
                          const isActive = playbackProgress >= column.position;
                          return (
                            <div
                              key={`imm-timeline-column-${column.position}`}
                              className="absolute bottom-[3px] w-[2px] rounded-full"
                              style={{
                                left: getTimelineAlignedLeft(column.position, -1),
                                height: `${column.height}px`,
                                backgroundColor: isActive ? tone.active : tone.inactive,
                                boxShadow: isActive ? `0 0 10px ${tone.glow}` : 'none',
                              }}
                            />
                          );
                        })}
                        {timelineMarkers.map((marker) => {
                          const markerStyle = TIMELINE_MARKER_STYLE[marker.type];
                          const leftPercent = safeDuration > 0 ? clamp((marker.time / safeDuration) * 100, 0, 100) : 0;
                          return (
                            <button
                              key={`imm-session-marker-${marker.id}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleTimelineMarkerClick(marker);
                              }}
                              onPointerDown={(event) => handleTimelineMarkerPointerDown(event, marker)}
                              onPointerMove={handleTimelinePointerMove}
                              onPointerUp={handleTimelinePointerUp}
                              onPointerCancel={handleTimelinePointerUp}
                              className="absolute top-[-28px] z-10 h-[50px] w-8 -translate-x-1/2"
                              style={{ left: getTimelineAlignedLeft(leftPercent) }}
                              title={`${timelineMarkerTypeLabels[marker.type]} • ${formatSecondsToClock(marker.time)}`}
                            >
                              <span className="pointer-events-none absolute inset-0 flex flex-col items-center pb-[2px]">
                                <span className="drop-shadow-[0_0_10px_rgba(0,0,0,0.48)]">
                                  <TimelineMarkerIcon type={marker.type} color={markerStyle.color} />
                                </span>
                                <span
                                  className="mt-[1px] w-[2.5px] flex-1 rounded-full"
                                  style={{
                                    backgroundColor: markerStyle.color,
                                    boxShadow: `0 0 12px ${markerStyle.glow}`,
                                  }}
                                />
                              </span>
                            </button>
                          );
                        })}
                        <div
                        className="absolute inset-y-[4px] z-[1] w-[2px] rounded-full bg-[#dbffff] shadow-[0_0_18px_rgba(219,255,255,0.78)]"
                          style={{ left: getTimelineAlignedLeft(playbackProgress, -1) }}
                        />
                      </div>
                      {timelineMenuState && (
                        <div
                          data-timeline-menu="1"
                          className="absolute bottom-full z-20 mb-2 -translate-x-1/2"
                          style={{ left: getTimelineAlignedLeft(timelineMenuState.leftPercent) }}
                        >
                          <div className="flex min-w-[170px] flex-col gap-1 rounded-2xl border border-[#2c5a61] bg-[#08141b]/95 p-2 shadow-[0_16px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                            {TIMELINE_MARKER_TYPES.map((type) => {
                              const markerStyle = TIMELINE_MARKER_STYLE[type];
                              return (
                                <button
                                  key={`imm-menu-${type}`}
                                  type="button"
                                  onClick={() => handleTimelineMenuSelect(type)}
                                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-black text-white/85 transition-colors hover:bg-white/[0.08]"
                                  style={{ borderColor: markerStyle.color }}
                                >
                                  <TimelineMarkerIcon type={type} color={markerStyle.color} />
                                  {timelineMarkerTypeLabels[type]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="relative mt-1.5 h-4">
                      <div className="absolute inset-x-2 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[#1a2930]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#5ff7e8] via-[#4bd6ff] to-[#87dfff]"
                          data-progress-fill="1"
                          style={{ width: `${playbackProgress}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={safeDuration}
                        step={0.1}
                        value={clampedCurrentTime}
                        onChange={(e) => handleSeek(Number(e.target.value), true)}
                        className="broadcast-range absolute inset-0 z-10 w-full"
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1 rounded-full border border-[#2c5a61] bg-[#08141b] p-[3px]">
                        <button
                          onClick={() => handleSeek(currentTime - 5, true)}
                          className="inline-flex h-8 min-w-[54px] items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 text-[11px] font-black tracking-[0.08em] text-white transition-colors hover:bg-white/[0.1]"
                          title="-5s"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          <span>-5s</span>
                        </button>
                        <button
                          onClick={handlePlayPause}
                          disabled={!isPlayerReady}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#79ffe9]/40 bg-[#63f6e7]/18 text-[#90fff3] transition-colors hover:bg-[#63f6e7]/24 disabled:cursor-not-allowed disabled:opacity-50"
                          title={isPlaying ? text.pause : text.play}
                        >
                          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                        </button>
                        <button
                          onClick={() => handleSeek(currentTime + 5, true)}
                          className="inline-flex h-8 min-w-[54px] items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 text-[11px] font-black tracking-[0.08em] text-white transition-colors hover:bg-white/[0.1]"
                          title="+5s"
                        >
                          <span>+5s</span>
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>

                      {renderPlaybackRateControl('imm-broadcast-speed')}

                      <button
                        type="button"
                        onClick={() => {
                          setTimelineMenuState(null);
                          setIsTimelineEditorOpen(true);
                        }}
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-[#2c5d63] bg-[#0d1821] px-3 text-[11px] font-black uppercase tracking-[0.14em] text-[#8efdf1] transition-colors hover:bg-[#12212d]"
                      >
                        <PencilLine className="h-4 w-4" />
                        {text.timelineMarkersButton}
                      </button>

                      {renderQualityControl('imm-broadcast-quality')}

                      <div className="flex items-center gap-2 rounded-full border border-[#2c5a61] bg-[#08141b] px-2.5 py-0.5">
                        <button
                          onClick={handleMuteToggle}
                          className="text-white/85 transition-colors hover:text-white"
                          title={isMuted ? 'Включить звук' : 'Выключить звук'}
                        >
                          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </button>
                        <div className="relative h-4 w-20 sm:w-28">
                          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#1e3238]" />
                          <div
                            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-[#5ff7e8] to-[#8ce8ff]"
                            style={{ width: `${isMuted ? 0 : volume}%` }}
                          />
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={isMuted ? 0 : volume}
                            onChange={(e) => handleVolumeChange(Number(e.target.value))}
                            className="broadcast-range absolute inset-0 z-10 w-full"
                            title="Громкость"
                          />
                        </div>
                      </div>

                      </div>
                      <span className="rounded-full border border-[#2c5a61] bg-[#08141b] px-2.5 py-1 text-[11px] font-black tracking-[0.14em] text-white/70">
                        {currentTimeLabel} / {durationLabel}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {isImmersiveMode && boardOverlay}
              {timelineEditorModal}
            </div>
            {!isImmersiveMode && boardOverlay}

            <div className={`${isImmersiveMode ? 'hidden' : ''} rounded-[24px] border border-[#2d5960]/55 bg-[linear-gradient(180deg,rgba(9,22,29,0.98),rgba(5,12,18,0.94))] px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:px-3 sm:py-2`}>
              <div className="relative">
                <div
                  data-timeline-rail="1"
                  className="relative h-7 overflow-visible rounded-[16px] border border-[#275754]/55 bg-[linear-gradient(180deg,rgba(7,35,31,0.9),rgba(5,24,23,0.96))]"
                  onPointerDown={handleTimelineRailPointerDown}
                  onPointerMove={handleTimelinePointerMove}
                  onPointerUp={handleTimelinePointerUp}
                  onPointerCancel={handleTimelinePointerUp}
                >
                  <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-[#62f7e8]/20" />
                  {DECORATIVE_TIMELINE_COLUMNS.map((column) => {
                    const tone = TIMELINE_TONE_STYLE[column.tone];
                    const isActive = playbackProgress >= column.position;
                    return (
                      <div
                        key={`timeline-column-${column.position}`}
                        className="absolute bottom-[3px] w-[2px] rounded-full"
                        style={{
                          left: getTimelineAlignedLeft(column.position, -1),
                          height: `${column.height}px`,
                          backgroundColor: isActive ? tone.active : tone.inactive,
                          boxShadow: isActive ? `0 0 10px ${tone.glow}` : 'none',
                        }}
                      />
                    );
                  })}
                  {timelineMarkers.map((marker) => {
                    const markerStyle = TIMELINE_MARKER_STYLE[marker.type];
                    const leftPercent = safeDuration > 0 ? clamp((marker.time / safeDuration) * 100, 0, 100) : 0;
                    return (
                      <button
                        key={`session-marker-${marker.id}`}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleTimelineMarkerClick(marker);
                        }}
                        onPointerDown={(event) => handleTimelineMarkerPointerDown(event, marker)}
                        onPointerMove={handleTimelinePointerMove}
                        onPointerUp={handleTimelinePointerUp}
                        onPointerCancel={handleTimelinePointerUp}
                        className="absolute top-[-28px] z-10 h-[50px] w-8 -translate-x-1/2"
                        style={{ left: getTimelineAlignedLeft(leftPercent) }}
                        title={`${timelineMarkerTypeLabels[marker.type]} • ${formatSecondsToClock(marker.time)}`}
                      >
                        <span className="pointer-events-none absolute inset-0 flex flex-col items-center pb-[2px]">
                          <span className="drop-shadow-[0_0_10px_rgba(0,0,0,0.48)]">
                            <TimelineMarkerIcon type={marker.type} color={markerStyle.color} />
                          </span>
                          <span
                            className="mt-[1px] w-[2.5px] flex-1 rounded-full"
                            style={{
                              backgroundColor: markerStyle.color,
                              boxShadow: `0 0 12px ${markerStyle.glow}`,
                            }}
                          />
                        </span>
                      </button>
                    );
                  })}
                  <div
                    className="absolute inset-y-[4px] z-[1] w-[2px] rounded-full bg-[#dbffff] shadow-[0_0_18px_rgba(219,255,255,0.78)]"
                    style={{ left: getTimelineAlignedLeft(playbackProgress, -1) }}
                  />
                </div>
                {timelineMenuState && (
                  <div
                    data-timeline-menu="1"
                    className="absolute bottom-full z-20 mb-2 -translate-x-1/2"
                    style={{ left: getTimelineAlignedLeft(timelineMenuState.leftPercent) }}
                  >
                    <div className="flex min-w-[170px] flex-col gap-1 rounded-2xl border border-[#2c5a61] bg-[#08141b]/95 p-2 shadow-[0_16px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                      {TIMELINE_MARKER_TYPES.map((type) => {
                        const markerStyle = TIMELINE_MARKER_STYLE[type];
                        return (
                          <button
                            key={`menu-${type}`}
                            type="button"
                            onClick={() => handleTimelineMenuSelect(type)}
                            className="rounded-xl border px-3 py-2 text-left text-sm font-black text-white/85 transition-colors hover:bg-white/[0.08]"
                            style={{ borderColor: markerStyle.color }}
                          >
                            {timelineMarkerTypeLabels[type]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative mt-1.5 h-4">
                <div className="absolute inset-x-2 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[#1a2930]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#5ff7e8] via-[#4bd6ff] to-[#87dfff]"
                    data-progress-fill="1"
                    style={{ width: `${playbackProgress}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={safeDuration}
                  step={0.1}
                  value={clampedCurrentTime}
                  onChange={(e) => handleSeek(Number(e.target.value), true)}
                  className="broadcast-range absolute inset-0 z-10 w-full"
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-full border border-[#2c5a61] bg-[#08141b] p-[3px]">
                  <button
                    onClick={() => handleSeek(currentTime - 5, true)}
                    className="inline-flex h-8 min-w-[54px] items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 text-[11px] font-black tracking-[0.08em] text-white transition-colors hover:bg-white/[0.1]"
                    title="-5s"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>-5s</span>
                  </button>
                  <button
                    onClick={handlePlayPause}
                    disabled={!isPlayerReady}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#79ffe9]/40 bg-[#63f6e7]/18 text-[#90fff3] transition-colors hover:bg-[#63f6e7]/24 disabled:cursor-not-allowed disabled:opacity-50"
                    title={isPlaying ? text.pause : text.play}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                  </button>
                  <button
                    onClick={() => handleSeek(currentTime + 5, true)}
                    className="inline-flex h-8 min-w-[54px] items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 text-[11px] font-black tracking-[0.08em] text-white transition-colors hover:bg-white/[0.1]"
                    title="+5s"
                  >
                    <span>+5s</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {renderPlaybackRateControl('broadcast-speed')}

                <button
                  type="button"
                  onClick={() => {
                    setTimelineMenuState(null);
                    setIsTimelineEditorOpen(true);
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-[#2c5d63] bg-[#0d1821] px-3 text-[11px] font-black uppercase tracking-[0.14em] text-[#8efdf1] transition-colors hover:bg-[#12212d]"
                >
                  <PencilLine className="h-4 w-4" />
                  {text.timelineMarkersButton}
                </button>

                {renderQualityControl('broadcast-quality')}

                <div className="flex items-center gap-2 rounded-full border border-[#2c5a61] bg-[#08141b] px-2.5 py-0.5">
                  <button
                    onClick={handleMuteToggle}
                    className="text-white/85 transition-colors hover:text-white"
                    title={isMuted ? 'Включить звук' : 'Выключить звук'}
                  >
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <div className="relative h-4 w-20 sm:w-28">
                    <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#1e3238]" />
                    <div
                      className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-[#5ff7e8] to-[#8ce8ff]"
                      style={{ width: `${isMuted ? 0 : volume}%` }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={isMuted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      className="broadcast-range absolute inset-0 z-10 w-full"
                      title="Громкость"
                    />
                  </div>
                </div>

                </div>
                <span className="rounded-full border border-[#2c5a61] bg-[#08141b] px-2.5 py-1 text-[11px] font-black tracking-[0.14em] text-white/70">
                  {currentTimeLabel} / {durationLabel}
                </span>
              </div>
            </div>
              </div>
            </section>
          </div>

          <aside className="h-fit space-y-4">
            <section className="rounded-[28px] border border-[#264c52]/55 bg-[linear-gradient(180deg,rgba(9,21,28,0.96),rgba(5,12,18,0.94))] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.3)]">
              <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-[#75efe0]">{text.sectionSession}</h3>
              <p className="mt-3 text-sm leading-6 text-white/72">{text.coachUiSubtitle}</p>
            </section>

            <section className="rounded-[28px] border border-[#264c52]/55 bg-[linear-gradient(180deg,rgba(9,21,28,0.96),rgba(5,12,18,0.94))] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.3)]">
              <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-[#75efe0]">{text.joinQr}</h2>
              {session.qrCode ? (
                <img src={session.qrCode} alt={text.joinQr} className="h-44 w-44 rounded-2xl bg-white p-2" />
              ) : (
                <p className="text-sm text-white/50">{text.qrNotAvailable}</p>
              )}
              <div className="mt-4 flex gap-2">
                <button onClick={() => copyToClipboard(joinUrl)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/[0.1]">
                  {text.copyJoinLink}
                </button>
              </div>
            </section>

            <section className="rounded-[28px] border border-[#264c52]/55 bg-[linear-gradient(180deg,rgba(9,21,28,0.96),rgba(5,12,18,0.94))] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.3)]">
              <h2 className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#75efe0]">
                {text.participants} ({participants.length})
              </h2>
              <p className="text-xs leading-5 text-white/48">{text.participantPencilColorHint}</p>
              <ul className="mt-4 max-h-56 space-y-2 overflow-auto pr-1">
                {participants.length === 0 && <li className="text-sm text-white/50">{text.noParticipants}</li>}
                {participants.map((participant) => (
                  <li
                    key={`${participant.userId}-${participant.id}`}
                    data-participant-color-picker="1"
                    className="rounded-2xl border border-[#1e3b40] bg-[#08141b] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveParticipantColorUserId((prev) => (prev === participant.userId ? null : participant.userId))
                        }
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#2b5c63] bg-[#0c1b22] transition-colors hover:bg-[#122530]"
                        title={text.participantPencilColor}
                      >
                        <span
                          className="h-4 w-4 rounded-full border border-black/20 shadow-[0_0_12px_rgba(255,255,255,0.12)]"
                          style={{ backgroundColor: normalizeParticipantColor(participant.color) }}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-white/85">{shortUserId(participant.userId)}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/38">{getRoleLabel(participant.role)}</p>
                      </div>
                    </div>
                    {activeParticipantColorUserId === participant.userId && (
                      <div className="mt-3 rounded-2xl border border-[#22474d] bg-[#0b1820] p-2">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
                          {text.participantPencilColor}
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {PARTICIPANT_COLORS.map((color) => {
                            const isActive = normalizeParticipantColor(participant.color) === color;
                            return (
                              <button
                                key={`${participant.userId}-${color}`}
                                type="button"
                                onClick={() => handleParticipantColorChange(participant.userId, color)}
                                className={`h-8 w-full rounded-full border transition-transform hover:scale-[1.05] ${
                                  isActive ? 'border-white shadow-[0_0_18px_rgba(255,255,255,0.18)]' : 'border-white/10'
                                }`}
                                style={{ backgroundColor: color }}
                                title={text.participantPencilColor}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[28px] border border-[#264c52]/55 bg-[linear-gradient(180deg,rgba(9,21,28,0.96),rgba(5,12,18,0.94))] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.3)]">
              <h2 className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#75efe0]">{text.displayMode}</h2>
              <p className="mt-3 text-sm text-white/64">{text.displayModeHint}</p>
              <div className="mt-4 flex gap-2">
                <Link href={`/display/${session.id}`} target="_blank" className="rounded-full border border-[#2c6267] bg-[#0b171d] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-[#8cf7ea] transition-colors hover:bg-[#10212a]">
                  {text.openDisplay}
                </Link>
                <button onClick={() => copyToClipboard(displayUrl)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/[0.1]">
                  {text.copyDisplayLink}
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
