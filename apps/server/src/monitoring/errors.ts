type ServerErrorLogEntry = {
  id: number;
  timestamp: string;
  source: string;
  message: string;
  stack: string | null;
  details: string | null;
};

type ErrorSourceSummary = {
  source: string;
  count: number;
};

const MAX_ERROR_LOGS = Number(process.env.ADMIN_ERROR_LOG_CAP || 1000);
const ERROR_LOG_WINDOW_MINUTES = Number(process.env.ADMIN_ERROR_LOG_WINDOW_MINUTES || 60);
const errors: ServerErrorLogEntry[] = [];
let nextErrorId = 1;
let consoleErrorCaptureInstalled = false;

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function normalizeErrorMessage(value: unknown) {
  if (value instanceof Error) return value.message || value.name || 'Error';
  if (typeof value === 'string') return value;
  if (value == null) return 'Unknown error';
  return safeJsonStringify(value);
}

function normalizeErrorStack(value: unknown) {
  if (value instanceof Error && typeof value.stack === 'string') {
    return value.stack;
  }
  return null;
}

function normalizeErrorDetails(value: unknown) {
  if (value == null) return null;
  if (value instanceof Error) {
    const details = {
      name: value.name,
      cause: (value as any).cause || null,
    };
    return safeJsonStringify(details);
  }
  if (typeof value === 'string') return null;
  return safeJsonStringify(value);
}

export function recordServerError(source: string, error: unknown, context?: unknown) {
  const entry: ServerErrorLogEntry = {
    id: nextErrorId++,
    timestamp: new Date().toISOString(),
    source: source || 'unknown',
    message: normalizeErrorMessage(error),
    stack: normalizeErrorStack(error),
    details: context == null ? normalizeErrorDetails(error) : normalizeErrorDetails(context),
  };

  errors.unshift(entry);
  const cap = Number.isFinite(MAX_ERROR_LOGS) && MAX_ERROR_LOGS > 100 ? MAX_ERROR_LOGS : 1000;
  if (errors.length > cap) {
    errors.length = cap;
  }
}

export function installConsoleErrorCapture() {
  if (consoleErrorCaptureInstalled) return;
  consoleErrorCaptureInstalled = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const [first, ...rest] = args;
      const source = typeof first === 'string' && first.trim() ? first.slice(0, 120) : 'console.error';
      const context = rest.length > 0 ? rest : null;
      recordServerError(source, first, context);
    } catch {
      // Ignore logging failures to keep console.error safe.
    }
    originalConsoleError(...args);
  };
}

export function getServerErrorLogs(limit = 200) {
  const safeLimit = Number.isFinite(limit) ? Math.min(1000, Math.max(20, Math.floor(limit))) : 200;
  return errors.slice(0, safeLimit);
}

export function clearServerErrorLogs() {
  errors.length = 0;
}

export function getServerErrorSummary(windowMinutes = ERROR_LOG_WINDOW_MINUTES) {
  const safeWindow = Number.isFinite(windowMinutes) ? Math.min(24 * 60, Math.max(1, Math.floor(windowMinutes))) : 60;
  const now = Date.now();
  const threshold = now - safeWindow * 60 * 1000;
  const sourceMap = new Map<string, number>();

  let inWindowCount = 0;
  for (const entry of errors) {
    const ts = new Date(entry.timestamp).getTime();
    if (Number.isFinite(ts) && ts >= threshold) {
      inWindowCount += 1;
      sourceMap.set(entry.source, (sourceMap.get(entry.source) || 0) + 1);
    }
  }

  const bySource: ErrorSourceSummary[] = [...sourceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([source, count]) => ({ source, count }));

  return {
    totalStored: errors.length,
    windowMinutes: safeWindow,
    inWindowCount,
    bySource,
  };
}

export type { ServerErrorLogEntry, ErrorSourceSummary };
